export interface Token {
  text: string
  x: number
  y: number
  w: number
  h: number
  conf: number
}

export interface Extraction {
  tokens: Token[]
  text: string
  source: 'pdf-text' | 'ocr'
  width: number
  height: number
}

export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
export const ACCEPTED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp']

export function isAcceptedFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXT.includes(ext)
}

interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/** Pull word boxes out of a Tesseract result across the v4 and v5 shapes. */
function collectWords(data: any): OcrWord[] {
  if (Array.isArray(data?.words) && data.words.length) return data.words as OcrWord[]
  const out: OcrWord[] = []
  const walk = (node: any) => {
    if (!node) return
    if (Array.isArray(node.words)) out.push(...node.words)
    for (const key of ['blocks', 'paragraphs', 'lines']) {
      if (Array.isArray(node[key])) node[key].forEach(walk)
    }
  }
  walk(data)
  return out
}

async function ocrCanvasOrBlob(
  input: HTMLCanvasElement | Blob,
  onProgress?: (p: number) => void,
): Promise<Token[]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress)
    },
  })
  try {
    const { data } = await worker.recognize(input, {}, { blocks: true, text: true })
    return collectWords(data)
      .filter((w) => w.text && w.text.trim().length > 0)
      .map((w) => ({
        text: w.text.trim(),
        x: w.bbox.x0,
        y: w.bbox.y0,
        w: w.bbox.x1 - w.bbox.x0,
        h: w.bbox.y1 - w.bbox.y0,
        conf: (w.confidence ?? 60) / 100,
      }))
  } finally {
    await worker.terminate()
  }
}

async function extractFromImage(file: File, onProgress?: (p: number) => void): Promise<Extraction> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image-decode'))
      el.src = url
    })
    const tokens = await ocrCanvasOrBlob(file, onProgress)
    return {
      tokens,
      text: tokens.map((t) => t.text).join(' '),
      source: 'ocr',
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function extractFromPdf(
  file: File,
  onProgress?: (p: number) => void,
  pageNumber = 1,
): Promise<Extraction> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const page = await doc.getPage(clampPage(pageNumber, doc.numPages))
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()

  const tokens: Token[] = content.items
    .filter((it: any) => typeof it.str === 'string' && it.str.trim())
    .map((it: any) => {
      const [, , , , e, f] = it.transform as number[]
      const h = it.height || 10
      return {
        text: it.str.trim(),
        x: e,
        y: viewport.height - f, // flip to top-down
        w: it.width || it.str.length * 5,
        h,
        conf: 1,
      }
    })

  const totalChars = tokens.reduce((n, t) => n + t.text.length, 0)
  if (totalChars >= 40) {
    return { tokens, text: tokens.map((t) => t.text).join(' '), source: 'pdf-text', width: viewport.width, height: viewport.height }
  }

  // Scanned / image-only PDF — rasterise page 1 and OCR it.
  const scale = Math.min(2.5, 1600 / viewport.width)
  const scaled = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = scaled.width
  canvas.height = scaled.height
  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport: scaled }).promise
  const ocrTokens = (await ocrCanvasOrBlob(canvas, onProgress)).map((t) => ({
    ...t,
    x: t.x / scale,
    y: t.y / scale,
    w: t.w / scale,
    h: t.h / scale,
  }))
  return {
    tokens: ocrTokens,
    text: ocrTokens.map((t) => t.text).join(' '),
    source: 'ocr',
    width: viewport.width,
    height: viewport.height,
  }
}

export async function extractDocument(
  file: File,
  onProgress?: (p: number) => void,
  pageNumber = 1,
): Promise<Extraction> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type === 'application/pdf' || ext === 'pdf') return extractFromPdf(file, onProgress, pageNumber)
  return extractFromImage(file, onProgress)
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/** Rasterise the source (an image, or one page of a PDF) at its natural size. */
export async function fileToCanvas(file: File, pageNumber = 1): Promise<HTMLCanvasElement> {
  if (isPdf(file)) {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    const page = await doc.getPage(clampPage(pageNumber, doc.numPages))
    // PDFs are vector — render at 2x so hairline rules land on real pixels.
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image-decode'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

const clampPage = (n: number, total: number) => Math.min(Math.max(1, Math.round(n)), Math.max(1, total))

export interface PdfPage {
  /** 1-based */
  number: number
  /** the heading this page carries, e.g. "Computer Science 1 — LT102" */
  label: string
}

/**
 * What each page of a PDF calls itself.
 *
 * An institute publishes one file holding a timetable per branch, and reading
 * only the first silently hands eleven students out of twelve somebody else's
 * schedule. Naming the pages lets the user say which one is theirs — and it is
 * nearly free, because the answer is sitting in the text layer: no rendering,
 * no OCR, just the first few lines of each page.
 *
 * A page with no readable heading still gets an entry, because it may well be
 * the one they want; it is simply listed by number.
 */
export async function pdfPages(file: File): Promise<PdfPage[]> {
  if (!isPdf(file)) return []
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  if (doc.numPages <= 1) return []

  const out: PdfPage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const items = (content.items as any[])
      .filter((it) => typeof it.str === 'string' && it.str.trim())
      .map((it) => ({ text: it.str.trim(), y: Math.round((it.transform as number[])[5]), x: (it.transform as number[])[4] }))
    out.push({ number: n, label: headingOf(items) })
  }
  return out
}

/** Institute name and semester repeat on every page; the branch does not. */
const BOILERPLATE =
  /institute|semester|time\s*table|number of hours|per week|per student|^period$|^time$|^\(|^note/i

function headingOf(items: Array<{ text: string; y: number; x: number }>): string {
  // group into lines, top of the page first
  const byY = new Map<number, Array<{ text: string; x: number }>>()
  for (const it of items) {
    const key = [...byY.keys()].find((k) => Math.abs(k - it.y) <= 3) ?? it.y
    const list = byY.get(key) ?? []
    list.push(it)
    byY.set(key, list)
  }
  const lines = [...byY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, cells]) =>
      cells
        .sort((a, b) => a.x - b.x)
        .map((c) => c.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )

  for (const line of lines.slice(0, 8)) {
    if (line.length < 3 || line.length > 90) continue
    if (BOILERPLATE.test(line)) continue
    if (/^[\d\s.:/-]+$/.test(line)) continue
    // A lone short word is wreckage from a wrapped heading — "student", left
    // over from "Number of hours per week per student" — not a branch name.
    // Real ones are either two words or a long one ("Mechanical").
    if (!line.includes(' ') && line.length < 10) continue
    return line
      .replace(/\s*Room No\.?:?\s*/i, ' — ')
      .replace(/\s+—\s*$/, '')
      .trim()
  }
  return ''
}
