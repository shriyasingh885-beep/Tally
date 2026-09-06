/**
 * Detects a ruled table's structure from the image's PIXELS rather than from
 * OCR output. Timetable exports (aSc, FET, most college software) draw solid
 * grid lines, and those lines survive downscaling far better than 9px text
 * does — so we can recover the exact row/column geometry even when OCR of the
 * cell contents is poor.
 *
 * The hard case throughout is the merged cell: a two-hour class erases its own
 * slice of a row boundary. One merged cell is harmless, but when every column
 * merges across the same boundary the rule disappears from a full-width scan
 * altogether and two periods silently become one. Row detection therefore runs
 * in three independent layers — full-width rules, then per-column rules, then
 * the row rhythm — so no single erasure can cost us a boundary.
 */

import { estimateLineHeight } from './ocrPrep'

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
  /** median height of the text lines in a region — drives how far OCR scales it up */
  textLineHeight: (x0: number, y0: number, x1: number, y1: number) => number
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
/** inside a single column a border is never interrupted, so demand near-all of it */
const STRIP_COVERAGE = 0.9
/** an interior lane divider, likewise */
const LANE_COVERAGE = 0.85
/** rules closer together than this are the same rule */
const MIN_SEP = 6
/** bridge dropouts this small — antialiasing and JPEG nick a hairline rule */
const RUN_GAP = 1

/**
 * A horizontal rule that a merged cell erases in EVERY column leaves no ink to
 * detect, so the two rows either side of it collapse into one tall band. aSc,
 * FET and similar exports rule their body rows at a constant pitch, so a gap
 * that is a clean integer multiple of that pitch is really N rows with the
 * interior rules rubbed out. Put them back — the per-column merge test in
 * extractTimetable still decides, from pixels, whether any given cell actually
 * spans a restored boundary, so this only ever adds candidate splits.
 */
export function fillImpliedRows(ys: number[]): number[] {
  if (ys.length < 3) return ys
  const gaps: number[] = []
  for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1])
  const pitch = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  if (!pitch || pitch < MIN_SEP) return ys

  const out: number[] = [ys[0]]
  for (let i = 1; i < ys.length; i++) {
    const g = ys[i] - ys[i - 1]
    const k = Math.round(g / pitch)
    // only a near-exact multiple (2x–8x) — a merely tall header or a slightly
    // uneven row must not be sliced up
    if (k >= 2 && k <= 8 && Math.abs(g / pitch - k) <= 0.2) {
      for (let j = 1; j < k; j++) out.push(Math.round(ys[i - 1] + (g * j) / k))
    }
    out.push(ys[i])
  }
  return out
}

/** Add positions that aren't already represented, keeping the originals exact. */
export function mergeRules(base: number[], extra: number[], minSep = MIN_SEP): number[] {
  const out = [...base]
  for (const v of extra) {
    if (!out.some((u) => Math.abs(u - v) < minSep)) out.push(v)
  }
  return out.sort((a, b) => a - b)
}

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
  /**
   * Longest unbroken stretch of ink along a scanline.
   *
   * This is what tells a ruled line apart from a line of text. A border is one
   * continuous stroke across its whole cell; glyphs are separated by paper
   * every few pixels, so a dense row of text has a long *total* but a short
   * longest run. Every "is there a border here?" test below measures the run,
   * never the total, which is why cell contents can never be mistaken for one.
   */
  const longestRun = (start: number, stride: number, count: number) => {
    let longest = 0
    let run = 0
    let gap = 0
    for (let i = 0, p = start; i < count; i++, p += stride) {
      if (ink[p]) {
        run += gap + 1
        gap = 0
        continue
      }
      if (!run) continue
      gap++
      if (gap > RUN_GAP) {
        if (run > longest) longest = run
        run = 0
        gap = 0
      }
    }
    return run > longest ? run : longest
  }

  /**
   * Ink belonging to runs at least `minRun` long, added up.
   *
   * A column border is not always one unbroken stroke: a row merged straight
   * across the table — a LUNCH BREAK band spanning every day — cuts every
   * interior rule in two. Judged on its longest run such a rule looks like half
   * a rule and gets thrown away, taking the column boundary with it and merging
   * two weekdays into one cell. Summing the long pieces survives the cut, while
   * glyph strokes, which are far shorter than `minRun`, still contribute
   * nothing.
   */
  const runTotal = (start: number, stride: number, count: number, minRun: number) => {
    let total = 0
    let run = 0
    let gap = 0
    for (let i = 0, p = start; i < count; i++, p += stride) {
      if (ink[p]) {
        run += gap + 1
        gap = 0
        continue
      }
      if (!run) continue
      gap++
      if (gap > RUN_GAP) {
        if (run >= minRun) total += run
        run = 0
        gap = 0
      }
    }
    if (run >= minRun) total += run
    return total
  }

  // Rules stay hairline even on big scans; filled bands do not.
  const maxThickness = Math.max(6, Math.round(Math.max(w, h) / 250))

  // --- pass 1: horizontal rules spanning most of the image ------------------
  const hHits: number[] = []
  for (let y = 0; y < h; y++) if (rowInk(y, 0, w - 1) > H_COVERAGE * w) hHits.push(y)
  let ys = clusterRuns(hHits, maxThickness)
  if (ys.length < 3) return null

  // --- pass 2: vertical rules, measured against the TALLEST rule ------------
  // Not against the candidate y-range: a page is rarely just a table. A legend,
  // a notes block or a signature line below it all produce full-width rules, so
  // that range can be half again the height of the timetable — and every column
  // border, which stops where the timetable stops, then falls under the bar and
  // is thrown away. Columns collapse into each other, two weekdays end up in one
  // cell, and only the first of them is ever seen.
  //
  // The tallest unbroken run on the page IS the table's own border, so measuring
  // every other rule against that is self-calibrating: interior columns of the
  // same height qualify, and shorter rules belonging to some other block below
  // do not.
  const bandTop = ys[0]
  const bandBottom = ys[ys.length - 1]
  if (bandBottom - bandTop < 40) return null

  const bandH = bandBottom - bandTop + 1
  let tallest = 0
  for (let x = 0; x < w; x++) {
    const run = longestRun(bandTop * w + x, w, bandH)
    if (run > tallest) tallest = run
  }
  if (tallest < 40) return null

  // Long enough to be part of a rule, far longer than any letter stroke.
  const minRuleRun = Math.max(20, Math.round(tallest * 0.08))
  const vHits: number[] = []
  for (let x = 0; x < w; x++) {
    if (runTotal(bandTop * w + x, w, bandH, minRuleRun) >= V_COVERAGE * tallest) vHits.push(x)
  }
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

  // --- pass 5: rules that survive in only one column ------------------------
  // When every day column merges across the same boundary — five parallel
  // 10:00-12:00 blocks, say — that rule is erased from the full-width scan and
  // pass 1 never sees it. It is still drawn in the time gutter, and in any
  // column that happened not to merge. So look for it one column at a time: an
  // unbroken, hairline segment filling a single strip is a row boundary,
  // whatever the rest of the table does at that height.
  const stripRules: number[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i] + 2
    const x1 = xs[i + 1] - 2
    const span = x1 - x0 + 1
    if (span < 12) continue
    const hits: number[] = []
    for (let y = Math.max(0, tableTop); y <= Math.min(h - 1, tableBottom); y++) {
      if (longestRun(y * w + x0, 1, span) >= STRIP_COVERAGE * span) hits.push(y)
    }
    stripRules.push(...clusterRuns(hits, maxThickness))
  }
  ys = mergeRules(ys, stripRules)

  // --- pass 6: rules erased from every column alike, inferred from rhythm ---
  ys = fillImpliedRows(ys)

  const hasHLine = (x0: number, x1: number, y: number) => {
    const ax0 = Math.max(0, x0)
    const ax1 = Math.min(w - 1, x1)
    const span = Math.max(1, ax1 - ax0 + 1)
    let best = 0
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= h) continue
      best = Math.max(best, longestRun(yy * w + ax0, 1, span))
    }
    return best >= SEGMENT_COVERAGE * span
  }

  const innerVLines = (x0: number, x1: number, y0: number, y1: number) => {
    const ay0 = Math.max(0, y0 + 2)
    const ay1 = Math.min(h - 1, y1 - 2)
    const span = ay1 - ay0 + 1
    if (span < 12) return []
    const hits: number[] = []
    // stay clear of the cell's own borders
    for (let x = Math.max(0, x0 + 3); x <= Math.min(w - 1, x1 - 3); x++) {
      if (longestRun(ay0 * w + x, w, span) >= LANE_COVERAGE * span) hits.push(x)
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

  const textLineHeight = (x0: number, y0: number, x1: number, y1: number) => {
    const ax0 = Math.max(0, Math.round(x0))
    const ay0 = Math.max(0, Math.round(y0))
    const ax1 = Math.min(w - 1, Math.round(x1))
    const ay1 = Math.min(h - 1, Math.round(y1))
    if (ax1 <= ax0 || ay1 <= ay0) return 0
    const profile: number[] = []
    for (let y = ay0; y <= ay1; y++) profile.push(rowInk(y, ax0, ax1))
    return estimateLineHeight(profile)
  }

  return { xs, ys, width: w, height: h, hasHLine, innerVLines, inkRatio, textLineHeight }
}
