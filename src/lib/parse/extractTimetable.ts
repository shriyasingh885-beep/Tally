import type { ClassDefinition, ClassType } from '../../types'
import { uid } from '../id'
import { minutesToClock, parseTimeRange } from '../time'
import { canonicalize } from './canonicalize'
import { detectGrid, type DetectedGrid } from './gridDetect'
import { extractDocument, fileToCanvas, isPdf, type Token } from './extractText'
import { matchDay, parseTimetable, type ParseResult } from './parseTimetable'

export type ProgressFn = (step: string, pct?: number) => void

/** Blow each cell up to roughly this tall before OCR — small type needs it. */
const TARGET_CELL_PX = 150
const MAX_CELL_PX = 1400
const CELL_INSET = 3
/** below this ink density a cell is a free period — don't pay for OCR */
const BLANK_INK = 0.004

const ROOM_RE = /\b((?:LAB|LT|ATC|CR|RM|LH|B|A|C|D|E|F|G|H)[-\s]?\d{2,4}[A-Z]?)\b/i
const BATCH_RE = /^[AB]\d?(?:\s*,\s*[AB]\d?)*$/i
/** initials-only lines like "NA, ShV" / "PrKh, IK" / "MuS" */
const FACULTY_RE = /^[A-Z][A-Za-z]{0,4}(?:\s*,\s*[A-Z][A-Za-z]{0,4})*$/

interface Worker {
  recognize: (img: unknown) => Promise<{ data: { text?: string } }>
  setParameters: (p: Record<string, string>) => Promise<unknown>
  terminate: () => Promise<unknown>
}

async function ocrRegion(
  worker: Worker,
  src: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<string> {
  const w = x1 - x0 - CELL_INSET * 2
  const h = y1 - y0 - CELL_INSET * 2
  if (w < 6 || h < 6) return ''

  const scale = Math.max(1, Math.min(6, TARGET_CELL_PX / h, MAX_CELL_PX / w))
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(src, x0 + CELL_INSET, y0 + CELL_INSET, w, h, 0, 0, c.width, c.height)

  try {
    const { data } = await worker.recognize(c)
    return (data.text ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * A PDF carries its own text layer — exact characters, exact positions. When
 * one is present we read cells straight from it and skip OCR entirely, which
 * is both perfect and ~50x faster than recognising rasterised glyphs.
 */
function tokensToRegionReader(tokens: Token[]): (x0: number, y0: number, x1: number, y1: number) => string {
  return (x0, y0, x1, y1) => {
    const inside = tokens.filter((t) => {
      const cx = t.x + t.w / 2
      const cy = t.y + t.h / 2
      return cx >= x0 && cx < x1 && cy >= y0 && cy < y1
    })
    if (!inside.length) return ''
    inside.sort((a, b) => a.y - b.y || a.x - b.x)
    const lines: string[][] = []
    let lastY = -Infinity
    for (const t of inside) {
      const tol = Math.max(4, t.h * 0.6)
      if (Math.abs(t.y - lastY) > tol) lines.push([])
      lines[lines.length - 1].push(t.text)
      lastY = t.y
    }
    return lines.map((l) => l.join(' ')).join('\n')
  }
}

function textLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/^[|_\-–—.,'"`~]+$/.test(l))
}

function classifyType(text: string): ClassType {
  if (/\blabs?\b|practical/i.test(text)) return 'lab'
  if (/\btut(orial)?\b/i.test(text)) return 'tutorial'
  return 'lecture'
}

/**
 * Cells in these exports stack as: subject / batch / faculty initials / room.
 * Take the subject off the top and the room off the bottom; drop the rest.
 */
function readCell(raw: string): { subject: string; room: string; type: ClassType } | null {
  const lines = textLines(raw)
  if (!lines.length) return null

  let room = ''
  const body: string[] = []
  for (const line of lines) {
    const m = line.match(ROOM_RE)
    if (m && !room && line.length <= m[1].length + 3) {
      room = m[1].replace(/\s+/g, '').toUpperCase()
      continue
    }
    body.push(line)
  }

  // The subject is the top line. Everything under it is batch / faculty /
  // room, and OCR mangles those badly enough that trying to tell them apart
  // just drags noise into the subject name.
  const subjectLines = body.length ? [body[0]] : []
  // Only pull in a second line when the first is too short to be a real name
  // and the next line isn't obviously a batch or a set of initials.
  if (subjectLines[0] && subjectLines[0].length < 4 && body[1]) {
    if (!BATCH_RE.test(body[1]) && !FACULTY_RE.test(body[1])) subjectLines.push(body[1])
  }

  const subject = subjectLines.join(' ').replace(/\s{2,}/g, ' ').trim()
  if (!subject) return null
  if (!room) {
    const anywhere = raw.match(ROOM_RE)
    if (anywhere) room = anywhere[1].replace(/\s+/g, '').toUpperCase()
  }
  return { subject, room, type: classifyType(raw) }
}

type ReadRegion = (x0: number, y0: number, x1: number, y1: number) => Promise<string> | string

/** Pick the band that actually holds day names — skips toolbars above the table. */
async function findHeaderRow(
  read: ReadRegion,
  grid: DetectedGrid,
): Promise<{ rowIndex: number; dayByCol: Map<number, number> } | null> {
  const maxProbe = Math.min(3, grid.ys.length - 1)
  let best: { rowIndex: number; dayByCol: Map<number, number> } | null = null

  for (let r = 0; r < maxProbe; r++) {
    const dayByCol = new Map<number, number>()
    for (let c = 0; c < grid.xs.length - 1; c++) {
      const text = await read(grid.xs[c], grid.ys[r], grid.xs[c + 1], grid.ys[r + 1])
      for (const word of textLines(text).join(' ').split(/[\s,/|]+/)) {
        const dow = matchDay(word)
        if (dow && ![...dayByCol.values()].includes(dow)) {
          dayByCol.set(c, dow)
          break
        }
      }
    }
    if (dayByCol.size >= 2 && (!best || dayByCol.size > best.dayByCol.size)) {
      best = { rowIndex: r, dayByCol }
    }
    if (dayByCol.size >= 4) break
  }
  return best
}

async function readTimeColumn(
  read: ReadRegion,
  grid: DetectedGrid,
  timeCol: number,
  firstBodyRow: number,
  onProgress: ProgressFn,
): Promise<Array<{ start: number; end: number } | null>> {
  const slots: Array<{ start: number; end: number } | null> = []
  const total = grid.ys.length - 1 - firstBodyRow

  for (let r = firstBodyRow; r < grid.ys.length - 1; r++) {
    const text = await read(grid.xs[timeCol], grid.ys[r], grid.xs[timeCol + 1], grid.ys[r + 1])
    const range = parseTimeRange(textLines(text).join(' '))
    slots.push(range && range.end != null ? { start: range.start, end: range.end } : null)
    onProgress('slots', (slots.length / Math.max(1, total)) * 100)
  }

  // Repair unreadable slots from their neighbours, then force the day to run
  // forwards (12-hour labels like "01:00-02:00" after noon read as 1 AM).
  const readable = slots.filter(Boolean) as Array<{ start: number; end: number }>
  const step = readable.length > 1 ? Math.round((readable[1].start - readable[0].start) / 60) * 60 || 60 : 60
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) continue
    const prev = i > 0 ? slots[i - 1] : null
    if (prev) slots[i] = { start: prev.end, end: prev.end + step }
  }
  for (let i = 1; i < slots.length; i++) {
    const cur = slots[i]
    const prev = slots[i - 1]
    if (!cur || !prev) continue
    while (cur.start < prev.start && cur.start + 12 * 60 < 24 * 60) {
      cur.start += 12 * 60
      cur.end += 12 * 60
    }
    if (cur.end <= cur.start) cur.end = cur.start + step
  }
  return slots
}

export async function extractTimetable(file: File, onProgress: ProgressFn): Promise<ParseResult> {
  onProgress('read', 0)
  const canvas = await fileToCanvas(file)
  onProgress('read', 100)

  onProgress('days', 0)
  const grid = detectGrid(canvas)

  // No ruled grid (a photo, a borderless layout) — fall back to inferring the
  // structure from OCR word positions.
  if (!grid || grid.xs.length < 3 || grid.ys.length < 3) {
    const flow = await extractDocument(file)
    return parseTimetable(flow)
  }

  // Prefer a PDF's embedded text layer over recognising pixels.
  let pdfRead: ReadRegion | null = null
  if (isPdf(file)) {
    try {
      const flow = await extractDocument(file)
      if (flow.source === 'pdf-text' && flow.tokens.length > 15) {
        // fileToCanvas renders PDFs at 2x; line up the text with that.
        const scaled = flow.tokens.map((t) => ({
          ...t,
          x: t.x * 2,
          y: t.y * 2,
          w: t.w * 2,
          h: t.h * 2,
        }))
        pdfRead = tokensToRegionReader(scaled)
      }
    } catch {
      /* fall through to OCR */
    }
  }

  // Only pull in Tesseract when we actually have to recognise pixels.
  let worker: Worker | null = null
  if (!pdfRead) {
    const { createWorker } = await import('tesseract.js')
    worker = (await createWorker('eng', 1)) as unknown as Worker
  }

  try {
    // Switching page-segmentation mode is a round-trip to the worker, so only
    // do it when the mode actually changes rather than once per cell.
    let psm = ''
    const withMode = (mode: string): ReadRegion =>
      pdfRead ??
      (async (x0, y0, x1, y1) => {
        if (psm !== mode) {
          await worker!.setParameters({ tessedit_pageseg_mode: mode })
          psm = mode
        }
        return ocrRegion(worker!, canvas, x0, y0, x1, y1)
      })

    const readLine = withMode('7') // a single line: day headers and time labels
    const readBlock = withMode('6') // a block: multi-line cell contents

    const header = await findHeaderRow(readLine, grid)
    if (!header) return { classes: [], ok: true, partial: true, reason: 'no-days' }
    onProgress('days', 100)

    const dayCols = [...header.dayByCol.keys()].sort((a, b) => a - b)
    // The time axis is whichever column sits left of the first day column.
    const timeCol = dayCols[0] > 0 ? dayCols[0] - 1 : -1
    const firstBodyRow = header.rowIndex + 1
    if (timeCol < 0 || firstBodyRow >= grid.ys.length - 1) {
      return { classes: [], ok: true, partial: true, reason: 'no-times' }
    }

    const slots = await readTimeColumn(readLine, grid, timeCol, firstBodyRow, onProgress)
    if (!slots.some(Boolean)) return { classes: [], ok: true, partial: true, reason: 'no-times' }

    onProgress('subjects', 0)

    const classes: ClassDefinition[] = []
    const consumed = new Set<string>()
    const bodyRows = grid.ys.length - 1 - firstBodyRow
    let done = 0
    const totalCells = bodyRows * dayCols.length

    for (let r = firstBodyRow; r < grid.ys.length - 1; r++) {
      const slot = slots[r - firstBodyRow]
      for (const c of dayCols) {
        done++
        onProgress('subjects', (done / Math.max(1, totalCells)) * 100)
        if (consumed.has(`${r}:${c}`) || !slot) continue

        // How many rows does this cell merge across? A missing bottom rule means
        // it keeps going.
        let span = 1
        while (
          r + span < grid.ys.length - 1 &&
          !grid.hasHLine(grid.xs[c] + 4, grid.xs[c + 1] - 4, grid.ys[r + span])
        ) {
          consumed.add(`${r + span}:${c}`)
          span++
        }

        const yTop = grid.ys[r]
        const yBot = grid.ys[r + span]
        const endSlot = slots[r + span - 1 - firstBodyRow]
        const endMin = endSlot ? endSlot.end : slot.end

        // Interior rules split a slot into parallel batches (B1 | B2 | B3).
        const inner = grid.innerVLines(grid.xs[c], grid.xs[c + 1], yTop, yBot)
        const edges = [grid.xs[c], ...inner, grid.xs[c + 1]]

        for (let s = 0; s < edges.length - 1; s++) {
          // Free periods are the majority of a timetable — skipping them is the
          // single biggest saving in the whole pass.
          if (grid.inkRatio(edges[s] + CELL_INSET, yTop + CELL_INSET, edges[s + 1] - CELL_INSET, yBot - CELL_INSET) < BLANK_INK) {
            continue
          }
          const text = await readBlock(edges[s], yTop, edges[s + 1], yBot)
          const cell = readCell(text)
          if (!cell) continue
          classes.push({
            id: uid('cls'),
            subject: cell.subject,
            room: cell.room,
            type: cell.type,
            dayOfWeek: header.dayByCol.get(c)!,
            startTime: minutesToClock(slot.start),
            endTime: minutesToClock(endMin),
          })
        }
      }
    }

    if (!classes.length) return { classes: [], ok: true, partial: true, reason: 'no-cells' }

    // Elect one spelling per subject across the whole week. Rooms are NOT
    // clustered: "LAB204" and "LAB207" are one character apart but are
    // different rooms, so merging them would be actively wrong.
    onProgress('rooms', 50)
    const subjectMap = canonicalize(classes.map((c) => c.subject))
    for (const c of classes) {
      c.subject = subjectMap.get(c.subject) ?? c.subject
      const review: string[] = []
      if (c.subject.length < 3) review.push('subject')
      if (!c.room) review.push('room')
      if (review.length) c.review = review
    }
    onProgress('rooms', 100)
    onProgress('organize', 100)

    const flagged = classes.filter((c) => c.review?.length).length
    return { classes, ok: true, partial: flagged > classes.length / 2 }
  } finally {
    await worker?.terminate()
  }
}
