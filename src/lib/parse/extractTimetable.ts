import type { BreakPeriod, ClassDefinition } from '../../types'
import { uid } from '../id'
import { minutesToClock, parseTimeRanges } from '../time'
import { canonicalize } from './canonicalize'
import { detectGrid, type DetectedGrid } from './gridDetect'
import { buildTimeAxis } from './timeAxis'
import { binarize, ocrScale } from './ocrPrep'
import { breakLabel, dedupeBreaks, isBreakLabel } from '../breaks'
import { extractDocument, fileToCanvas, isPdf, type Token } from './extractText'
import { matchDay, parseTimetable, type ParseResult } from './parseTimetable'
import { analyseCorpus, classifyCell, type Corpus, type RawCell } from './cellModel'
import { scoreConfidence, validateClasses } from './validate'

export type ProgressFn = (step: string, pct?: number) => void

/**
 * Blow each cell up until its TYPE is about this tall. Tesseract wants roughly
 * 30px letters; timetable screenshots supply about 9.
 */
const TARGET_LINE_PX = 32
/** fallback when a cell's ink profile is too noisy to find a line height in */
const TARGET_CELL_PX = 150
const MAX_CELL_PX = 1600
const MAX_CELL_H = 1000
const MAX_SCALE = 6
const CELL_INSET = 3
/** below this ink density a cell is a free period — don't pay for OCR */
const BLANK_INK = 0.004
/** no real class merges across more rows than this — a longer walk is a bug */
const MAX_ROW_SPAN = 8
/** entries below this are shown as needing review rather than as fact */
const LOW_CONFIDENCE = 0.6

interface Worker {
  recognize: (img: unknown) => Promise<{ data: { text?: string; confidence?: number } }>
  setParameters: (p: Record<string, string>) => Promise<unknown>
  terminate: () => Promise<unknown>
}

export interface RegionText {
  text: string
  /** 0–1 */
  confidence: number
}

type ReadRegion = (x0: number, y0: number, x1: number, y1: number) => Promise<RegionText> | RegionText

async function ocrRegion(
  worker: Worker,
  src: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lineHeight: number,
): Promise<RegionText> {
  const w = x1 - x0 - CELL_INSET * 2
  const h = y1 - y0 - CELL_INSET * 2
  if (w < 6 || h < 6) return { text: '', confidence: 0 }

  const scale = ocrScale({
    lineHeight,
    cellWidth: w,
    cellHeight: h,
    targetLine: TARGET_LINE_PX,
    targetCell: TARGET_CELL_PX,
    maxWidth: MAX_CELL_PX,
    maxHeight: MAX_CELL_H,
    maxScale: MAX_SCALE,
  })
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(src, x0 + CELL_INSET, y0 + CELL_INSET, w, h, 0, 0, c.width, c.height)

  // Smooth upscaling leaves grey haloes around every stroke; flatten them back
  // to solid black on solid white so the recogniser sees glyph shapes, not fog.
  const img = ctx.getImageData(0, 0, c.width, c.height)
  binarize(img.data, c.width, c.height)
  ctx.putImageData(img, 0, 0)

  try {
    const { data } = await worker.recognize(c)
    return { text: (data.text ?? '').trim(), confidence: (data.confidence ?? 60) / 100 }
  } catch {
    return { text: '', confidence: 0 }
  }
}

/**
 * A PDF carries its own text layer — exact characters, exact positions. When
 * one is present we read cells straight from it and skip OCR entirely, which
 * is both perfect and ~50x faster than recognising rasterised glyphs.
 */
function tokensToRegionReader(tokens: Token[]): ReadRegion {
  return (x0, y0, x1, y1) => {
    const inside = tokens.filter((t) => {
      const cx = t.x + t.w / 2
      const cy = t.y + t.h / 2
      return cx >= x0 && cx < x1 && cy >= y0 && cy < y1
    })
    if (!inside.length) return { text: '', confidence: 1 }
    inside.sort((a, b) => a.y - b.y || a.x - b.x)
    const lines: string[][] = []
    let lastY = -Infinity
    for (const t of inside) {
      const tol = Math.max(4, t.h * 0.6)
      if (Math.abs(t.y - lastY) > tol) lines.push([])
      lines[lines.length - 1].push(t.text)
      lastY = t.y
    }
    return { text: lines.map((l) => l.join(' ')).join('\n'), confidence: 1 }
  }
}

export function textLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/^[|_\-–—.,'"`~]+$/.test(l))
}

/** Pick the band that actually holds day names — skips toolbars above the table. */
async function findHeaderRow(
  read: ReadRegion,
  grid: DetectedGrid,
): Promise<{ rowIndex: number; dayByCol: Map<number, number> } | null> {
  // Probe deep enough to clear a masthead. An institute timetable can spend
  // three or four ruled rows on a crest, a title and a semester line before the
  // day names appear; stopping at row 3 finds nothing and the whole parse is
  // reported as "no recognisable grid". Rows are only read until four days turn
  // up, so a normal timetable with its header on row 0 still costs one probe.
  const maxProbe = Math.min(8, grid.ys.length - 1)

  const perRow: Array<Map<number, number>> = []
  for (let r = 0; r < maxProbe; r++) {
    const dayByCol = new Map<number, number>()
    for (let c = 0; c < grid.xs.length - 1; c++) {
      const { text } = await read(grid.xs[c], grid.ys[r], grid.xs[c + 1], grid.ys[r + 1])
      for (const word of textLines(text).join(' ').split(/[\s,/|]+/)) {
        const dow = matchDay(word)
        if (dow && ![...dayByCol.values()].includes(dow)) {
          dayByCol.set(c, dow)
          break
        }
      }
    }
    perRow.push(dayByCol)
    // four days is a header; nothing below it will beat that
    if (dayByCol.size >= 4 && r + 1 < maxProbe) {
      // keep going one row in case the heading straddles a rule (see below)
      if (perRow.length > 1 && perRow[r - 1]?.size) break
    }
  }

  const start = perRow.findIndex((m) => m.size >= 2)
  if (start < 0) return null

  // A heading is not always one row tall. A rule drawn through it — or a
  // two-line heading — puts "MONDAY" on one row and the rest of the header,
  // including the word "TIME", on the next. Taking the first of those as the
  // header leaves the leftover row looking like a period with no time label,
  // and the axis then invents an hour for it that the morning's real classes
  // merge into. So take the header as the whole run of rows carrying day
  // names, and start the body after the last of them.
  const dayByCol = new Map<number, number>()
  let rowIndex = start
  for (let r = start; r < perRow.length; r++) {
    if (r > start && perRow[r].size === 0) break
    for (const [c, dow] of perRow[r]) {
      if (![...dayByCol.values()].includes(dow)) dayByCol.set(c, dow)
    }
    rowIndex = r
  }
  return { rowIndex, dayByCol }
}

/** Raw label text for every body row of the time gutter, unparsed. */
async function readTimeLabels(
  read: ReadRegion,
  grid: DetectedGrid,
  timeCol: number,
  firstBodyRow: number,
  onProgress: ProgressFn,
): Promise<string[]> {
  const texts: string[] = []
  const total = grid.ys.length - 1 - firstBodyRow

  for (let r = firstBodyRow; r < grid.ys.length - 1; r++) {
    const { text } = await read(grid.xs[timeCol], grid.ys[r], grid.xs[timeCol + 1], grid.ys[r + 1])
    texts.push(textLines(text).join(' '))
    onProgress('slots', (texts.length / Math.max(1, total)) * 100)
  }
  return texts
}

/**
 * Turn raw cells into validated, structured classes.
 *
 * Split out from the document plumbing so it can be unit tested directly:
 * everything from here on is pure logic over RawCell records — no canvas, no
 * OCR engine, no DOM.
 */
export function buildClasses(cells: RawCell[]): {
  classes: ClassDefinition[]
  breaks: BreakPeriod[]
  corpus: Corpus
} {
  // Lunch is printed as a row like any other, so lift it out before anything
  // treats it as a subject — otherwise it lands in the class list with an
  // attendance checkbox, and a meal starts counting against your percentage.
  const breakCells = cells.filter((c) => isBreakLabel(c.lines[0] ?? ''))
  const breaks = dedupeBreaks(
    breakCells.map((c) => ({
      id: uid('brk'),
      label: breakLabel(c.lines[0]),
      startTime: minutesToClock(c.startMin),
      endTime: minutesToClock(c.endMin),
    })),
  )
  cells = cells.filter((c) => !isBreakLabel(c.lines[0] ?? ''))

  const corpus = analyseCorpus(cells)

  const drafts: Array<{ cls: ClassDefinition; cell: RawCell }> = []
  for (const cell of cells) {
    const parsed = classifyCell(cell, corpus)
    if (!parsed) continue
    drafts.push({
      cell,
      cls: {
        id: uid('cls'),
        subject: parsed.subject,
        room: parsed.room,
        teacher: parsed.teacher || undefined,
        batch: parsed.batch || undefined,
        type: parsed.type,
        dayOfWeek: cell.dayOfWeek,
        startTime: minutesToClock(cell.startMin),
        endTime: minutesToClock(cell.endMin),
        originalText: cell.originalText,
        sourceCell: cell.source,
      },
    })
  }

  // Elect one spelling per subject across the whole week. Rooms are NOT
  // clustered: "LAB204" and "LAB207" are one character apart but are
  // different rooms, so merging them would be actively wrong.
  const subjectMap = canonicalize(drafts.map((d) => d.cls.subject))
  for (const d of drafts) d.cls.subject = subjectMap.get(d.cls.subject) ?? d.cls.subject

  const subjectCounts = new Map<string, number>()
  for (const d of drafts) {
    const k = d.cls.subject.toLowerCase()
    subjectCounts.set(k, (subjectCounts.get(k) ?? 0) + 1)
  }

  const cellById = new Map<string, RawCell>()
  for (const d of drafts) {
    d.cls.confidence = scoreConfidence(d.cls, d.cell, corpus, subjectCounts)
    cellById.set(d.cls.id, d.cell)
  }

  const { classes, issues } = validateClasses(
    drafts.map((d) => d.cls),
    cellById,
    corpus,
  )

  // Surface uncertainty as review flags rather than silently presenting guesses.
  const issuesById = new Map<string, string[]>()
  for (const i of issues) {
    const list = issuesById.get(i.classId) ?? []
    list.push(i.field)
    issuesById.set(i.classId, list)
  }
  for (const c of classes) {
    const review = new Set(issuesById.get(c.id) ?? [])
    if ((c.confidence ?? 1) < LOW_CONFIDENCE) review.add('subject')
    if (c.subject.replace(/[^A-Za-z]/g, '').length < 3) review.add('subject')
    if (!c.room && corpus.roomCoverage > 0.6) review.add('room')
    if (review.size) c.review = [...review]
  }

  return { classes, breaks, corpus }
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
        const scaled = flow.tokens.map((t) => ({ ...t, x: t.x * 2, y: t.y * 2, w: t.w * 2, h: t.h * 2 }))
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
    // Cells are cropped out of a screenshot with no DPI of their own; telling
    // Tesseract what to assume stops it second-guessing the scale we chose.
    await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1' })
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
        const lineHeight = grid.textLineHeight(
          x0 + CELL_INSET,
          y0 + CELL_INSET,
          x1 - CELL_INSET,
          y1 - CELL_INSET,
        )
        return ocrRegion(worker!, canvas, x0, y0, x1, y1, lineHeight)
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

    const rawLabels = await readTimeLabels(readLine, grid, timeCol, firstBodyRow, onProgress)

    // A header does not always end where its day names do. A stray rule through
    // the heading leaves the word "TIME" stranded on a row of its own, and that
    // row has no period label — so the axis backfills one from the row below and
    // invents a 7:45 slot that the morning's real classes then merge into.
    // Step over leading rows that carry neither a time nor any class: they are
    // the tail of the heading, not the start of the day. A row with content is
    // kept even when its label is unreadable, so a genuine first period whose
    // label failed OCR is still repaired rather than dropped.
    let skip = 0
    while (skip < rawLabels.length && !parseTimeRanges(rawLabels[skip]).length) {
      const r = firstBodyRow + skip
      const hasContent = dayCols.some(
        (c) =>
          grid.inkRatio(
            grid.xs[c] + CELL_INSET,
            grid.ys[r] + CELL_INSET,
            grid.xs[c + 1] - CELL_INSET,
            grid.ys[r + 1] - CELL_INSET,
          ) >= BLANK_INK,
      )
      if (hasContent) break
      skip++
    }
    const bodyRow0 = firstBodyRow + skip
    const labels = rawLabels.slice(skip)
    if (bodyRow0 >= grid.ys.length - 1) {
      return { classes: [], ok: true, partial: true, reason: 'no-times' }
    }

    // The labels have the last word on the row structure: a cell carrying two
    // of them proves a boundary the pixels lost, so the axis can hand back
    // corrected geometry to go with its slots.
    const axis = buildTimeAxis(grid.ys.slice(bodyRow0), labels)
    if (!axis.slots.some(Boolean)) return { classes: [], ok: true, partial: true, reason: 'no-times' }
    const ys = [...grid.ys.slice(0, bodyRow0), ...axis.ys]
    const slots = axis.slots

    onProgress('subjects', 0)

    // ---- pass A: read every occupied cell, keeping its geometry ----
    const cells: RawCell[] = []
    const consumed = new Set<string>()
    const bodyRows = ys.length - 1 - bodyRow0
    let done = 0
    const totalCells = bodyRows * dayCols.length

    for (let r = bodyRow0; r < ys.length - 1; r++) {
      const slot = slots[r - bodyRow0]
      for (const c of dayCols) {
        done++
        onProgress('subjects', (done / Math.max(1, totalCells)) * 100)
        if (consumed.has(`${r}:${c}`) || !slot) continue

        // How many rows does this cell merge across? A missing bottom rule means
        // it keeps going — that's one two-hour class, not two one-hour classes.
        // The cap matters: if rule detection failed for a whole column, an
        // uncapped walk would swallow the entire day into one bogus class.
        let span = 1
        while (
          span < MAX_ROW_SPAN &&
          r + span < ys.length - 1 &&
          !grid.hasHLine(grid.xs[c] + 4, grid.xs[c + 1] - 4, ys[r + span])
        ) {
          consumed.add(`${r + span}:${c}`)
          span++
        }

        const yTop = ys[r]
        const yBot = ys[r + span]
        // Every row the cell covers must be accounted for, so take the end from
        // the last one that has a slot rather than assuming the span's own tail.
        let endSlot = slots[r + span - 1 - bodyRow0]
        for (let k = span - 1; k >= 0 && !endSlot; k--) endSlot = slots[r + k - bodyRow0]
        const endMin = Math.max(slot.end, endSlot ? endSlot.end : slot.end)

        // Interior rules split one slot into parallel batches (B1 | B2 | B3).
        // Each slice is its own class sharing the exact same time range.
        const inner = grid.innerVLines(grid.xs[c], grid.xs[c + 1], yTop, yBot)
        const edges = [grid.xs[c], ...inner, grid.xs[c + 1]]

        for (let s = 0; s < edges.length - 1; s++) {
          // Free periods are the majority of a timetable — skipping them is the
          // single biggest saving in the whole pass.
          if (
            grid.inkRatio(
              edges[s] + CELL_INSET,
              yTop + CELL_INSET,
              edges[s + 1] - CELL_INSET,
              yBot - CELL_INSET,
            ) < BLANK_INK
          ) {
            continue
          }
          const { text, confidence } = await readBlock(edges[s], yTop, edges[s + 1], yBot)
          const lines = textLines(text)
          if (!lines.length) continue
          cells.push({
            lines,
            originalText: text,
            dayOfWeek: header.dayByCol.get(c)!,
            startMin: slot.start,
            endMin,
            ocrConfidence: confidence,
            timeInferred: slot.inferred || (endSlot?.inferred ?? false),
            source: { row: r, col: c, rowSpan: span, lane: s, lanes: edges.length - 1 },
          })
        }
      }
    }

    if (!cells.length) return { classes: [], ok: true, partial: true, reason: 'no-cells' }

    // ---- passes B–E: corpus analysis, classification, validation ----
    onProgress('rooms', 50)
    const { classes, breaks } = buildClasses(cells)
    onProgress('rooms', 100)
    onProgress('organize', 100)

    if (!classes.length) return { classes: [], ok: true, partial: true, reason: 'no-cells' }

    // An hour the axis couldn't account for is exactly how a missing rule used
    // to hide: everything looks fine, but a class is simply not there. Send the
    // user to the review screen with it named rather than let it pass.
    const flagged = classes.filter((c) => c.review?.length).length
    const messy = flagged > classes.length / 2
    return {
      classes,
      breaks,
      ok: true,
      partial: messy || axis.gaps.length > 0,
      reason: axis.gaps.length && !messy ? 'time-gap' : undefined,
      warnings: axis.warnings.length ? axis.warnings : undefined,
    }
  } finally {
    await worker?.terminate()
  }
}
