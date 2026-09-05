/**
 * Detects a ruled table's structure from the image's PIXELS rather than from
 * OCR output. Timetable exports (aSc, FET, most college software) draw solid
 * grid lines, and those lines survive downscaling far better than 9px text
 * does — so we can recover the exact row/column geometry even when OCR of the
 * cell contents is poor.
 */

export interface DetectedGrid {
  /** vertical rule positions, left→right (canvas px) */
  xs: number[]
  /** horizontal rule positions, top→bottom (canvas px) */
  ys: number[]
  width: number
  height: number
  /** is there a horizontal rule at `y` spanning most of [x0,x1]? (merged-cell test) */
  hasHLine: (x0: number, x1: number, y: number) => boolean
  /** interior vertical rules inside a cell — parallel lab batches etc. */
  innerVLines: (x0: number, x1: number, y0: number, y1: number) => number[]
  /** fraction of ink inside a region — used to skip empty cells before OCR */
  inkRatio: (x0: number, y0: number, x1: number, y1: number) => number
}

const INK_LUMA = 170
/** a vertical rule runs the whole table height, so it must be near-complete */
const V_COVERAGE = 0.7
/**
 * A horizontal rule is routinely interrupted by merged cells (a 2-hour class
 * erases its own slice of the boundary), so it needs a much looser bar. Text
 * rows sit well under 30% ink, so 0.5 still separates rules from content.
 */
const H_COVERAGE = 0.5
/** a per-cell border test — that segment is either fully drawn or absent */
const SEGMENT_COVERAGE = 0.72
/** rules closer together than this are the same rule */
const MIN_SEP = 6

/**
 * Collapse consecutive hit rows/columns into single rule positions.
 * `maxThickness` rejects solid filled bands — a window title bar or a coloured
 * toolbar spans the full width just like a rule does, but it's 10-20px deep
 * where a real grid rule is 1-3px.
 */
function clusterRuns(hits: number[], maxThickness: number): number[] {
  if (!hits.length) return []
  const out: number[] = []
  let start = hits[0]
  let prev = hits[0]
  const flush = () => {
    if (prev - start + 1 <= maxThickness) out.push(Math.round((start + prev) / 2))
  }
  for (let i = 1; i <= hits.length; i++) {
    const v = hits[i]
    if (v !== undefined && v - prev <= 2) {
      prev = v
      continue
    }
    flush()
    if (v === undefined) break
    start = v
    prev = v
  }
  // drop near-duplicates
  return out.filter((v, i) => i === 0 || v - out[i - 1] >= MIN_SEP)
}

export function detectGrid(canvas: HTMLCanvasElement): DetectedGrid | null {
  const w = canvas.width
  const h = canvas.height
  if (!w || !h) return null

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const data = ctx.getImageData(0, 0, w, h).data

  // 1-bit ink mask
  const ink = new Uint8Array(w * h)
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    // treat transparent pixels as paper
    ink[p] = data[i + 3] > 40 && luma < INK_LUMA ? 1 : 0
  }

  const rowInk = (y: number, x0: number, x1: number) => {
    let n = 0
    const off = y * w
    for (let x = x0; x <= x1; x++) if (ink[off + x]) n++
    return n
  }
  const colInk = (x: number, y0: number, y1: number) => {
    let n = 0
    for (let y = y0; y <= y1; y++) if (ink[y * w + x]) n++
    return n
  }

  // Rules stay hairline even on big scans; filled bands do not.
  const maxThickness = Math.max(6, Math.round(Math.max(w, h) / 250))

  // --- pass 1: horizontal rules spanning most of the image ------------------
  const hHits: number[] = []
  for (let y = 0; y < h; y++) if (rowInk(y, 0, w - 1) > H_COVERAGE * w) hHits.push(y)
  let ys = clusterRuns(hHits, maxThickness)
  if (ys.length < 3) return null

  // --- pass 2: vertical rules, measured across the candidate y-range --------
  const tableH = ys[ys.length - 1] - ys[0]
  if (tableH < 40) return null

  const vHits: number[] = []
  for (let x = 0; x < w; x++) if (colInk(x, ys[0], ys[ys.length - 1]) > V_COVERAGE * tableH) vHits.push(x)
  const xs = clusterRuns(vHits, maxThickness)
  if (xs.length < 3) return null

  // --- pass 3: the vertical rules define the table's true top and bottom ----
  // Chrome/OS window chrome above the table (title bars, toolbars) can look
  // like a full-width rule; the real table starts where its columns start.
  const tops: number[] = []
  const bottoms: number[] = []
  for (const x of xs) {
    let first = -1
    let last = -1
    for (let y = 0; y < h; y++) {
      if (ink[y * w + x]) {
        if (first < 0) first = y
        last = y
      }
    }
    if (first >= 0) {
      tops.push(first)
      bottoms.push(last)
    }
  }
  if (!tops.length) return null
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]
  const tableTop = median(tops)
  const tableBottom = median(bottoms)

  // --- pass 4: re-qualify horizontal rules against the table's own box ------
  const xL = xs[0]
  const xR = xs[xs.length - 1]
  const tableW = xR - xL
  ys = ys.filter(
    (y) => y >= tableTop - 4 && y <= tableBottom + 4 && rowInk(y, xL, xR) > H_COVERAGE * tableW,
  )
  if (ys.length < 3) return null

  const hasHLine = (x0: number, x1: number, y: number) => {
    const span = Math.max(1, x1 - x0)
    let best = 0
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= h) continue
      best = Math.max(best, rowInk(yy, Math.max(0, x0), Math.min(w - 1, x1)))
    }
    return best > SEGMENT_COVERAGE * span
  }

  const innerVLines = (x0: number, x1: number, y0: number, y1: number) => {
    const span = Math.max(1, y1 - y0)
    if (span < 12) return []
    const hits: number[] = []
    // stay clear of the cell's own borders
    for (let x = Math.max(0, x0 + 3); x <= Math.min(w - 1, x1 - 3); x++) {
      if (colInk(x, Math.max(0, y0 + 2), Math.min(h - 1, y1 - 2)) > 0.8 * span) hits.push(x)
    }
    return clusterRuns(hits, maxThickness)
  }

  const inkRatio = (x0: number, y0: number, x1: number, y1: number) => {
    const ax0 = Math.max(0, Math.round(x0))
    const ay0 = Math.max(0, Math.round(y0))
    const ax1 = Math.min(w - 1, Math.round(x1))
    const ay1 = Math.min(h - 1, Math.round(y1))
    const area = Math.max(1, (ax1 - ax0 + 1) * (ay1 - ay0 + 1))
    let n = 0
    for (let y = ay0; y <= ay1; y++) {
      const off = y * w
      for (let x = ax0; x <= ax1; x++) if (ink[off + x]) n++
    }
    return n / area
  }

  return { xs, ys, width: w, height: h, hasHLine, innerVLines, inkRatio }
}
