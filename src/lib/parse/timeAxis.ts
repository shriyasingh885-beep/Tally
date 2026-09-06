/**
 * Turning a column of time labels into a trustworthy axis.
 *
 * This is the part of extraction that ruins a timetable quietly when it goes
 * wrong. A row boundary that no longer exists in the pixels merges two periods
 * into one band; that band's label cell then reads "10:00-11:00 11:00-12:00";
 * only the first range survives; and a whole hour of every weekday vanishes
 * with nothing looking broken. Everything here exists so that failure, and its
 * relatives, either repairs itself or says so out loud.
 *
 * The rules, in order of authority:
 *   1. Two labels in one cell is proof that a boundary is missing — cut the row.
 *   2. A label we couldn't read is filled from its neighbours, forwards *and*
 *      backwards, and marked inferred so confidence scoring can discount it.
 *   3. 12-hour labels ("01:00-02:00") are resolved by the one fact we can rely
 *      on: a school day runs forwards.
 *   4. Whatever is left must tile the day without holes or overlaps. Overlaps
 *      are clamped; holes are reported, never papered over.
 */

import { parseTimeRanges, type TimeRange } from '../time'

export interface Slot {
  start: number
  end: number
  /** true when this row's label could not be read and was filled from neighbours */
  inferred: boolean
}

export interface TimeAxis {
  /** row boundaries, with any collapsed row cut into its real periods */
  ys: number[]
  /** one slot per row of `ys`, or null where nothing could be established */
  slots: Array<Slot | null>
  /** minutes per period, as read from the document */
  step: number
  /**
   * Stretches of the day no row accounts for. A non-empty list is the symptom
   * of the bug this module exists to prevent, so it is surfaced to the user
   * rather than left for them to notice a missing class weeks later.
   */
  gaps: Array<{ from: number; to: number }>
  warnings: string[]
}

const DEFAULT_STEP = 60
const MIN_STEP = 5
const MAX_STEP = 240
const HALF_DAY = 12 * 60

function median(values: number[]): number | null {
  if (!values.length) return null
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
}

/**
 * Resolve 12-hour labels against the only thing we can count on: a day runs
 * forwards. "01:00-02:00" following "11:00-12:00" is the afternoon, and an end
 * that lands before its own start has wrapped past noon.
 */
function unwrapClock(ranges: Array<TimeRange | null>): void {
  let last = -Infinity
  for (const r of ranges) {
    if (!r) continue
    while (r.start < last && r.start + HALF_DAY < 24 * 60) r.start += HALF_DAY
    last = r.start
    if (r.end != null) {
      while (r.end <= r.start && r.end + HALF_DAY <= 24 * 60) r.end += HALF_DAY
    }
  }
}

/**
 * Build the time axis for a stack of rows.
 *
 * `ys` are the row boundaries (n+1 of them for n rows) and `rowTexts` the raw
 * label read from each row's cell in the time gutter. Both the geometry and the
 * slots come back adjusted together, so a caller can splice the new boundaries
 * straight back into its grid.
 */
export function buildTimeAxis(ys: number[], rowTexts: string[]): TimeAxis {
  const warnings: string[] = []
  const gaps: TimeAxis['gaps'] = []
  const rowCount = Math.max(0, ys.length - 1)
  if (rowCount === 0) return { ys: [...ys], slots: [], step: DEFAULT_STEP, gaps, warnings }

  const texts = Array.from({ length: rowCount }, (_, i) => rowTexts[i] ?? '')

  // --- 1. a cell holding more than one label is a row that lost its rule ----
  const outYs: number[] = [ys[0]]
  const ranges: Array<TimeRange | null> = []
  for (let r = 0; r < rowCount; r++) {
    const top = ys[r]
    const bot = ys[r + 1]
    const found = parseTimeRanges(texts[r])
    const parts = Math.max(1, found.length)
    if (parts > 1) {
      warnings.push(
        `row ${r} carried ${parts} time labels — a missing rule had merged ${parts} periods into one band`,
      )
    }
    // cut the band into equal periods; the labels themselves say how many
    for (let p = 1; p < parts; p++) outYs.push(Math.round(top + ((bot - top) * p) / parts))
    outYs.push(bot)
    for (let p = 0; p < parts; p++) ranges.push(found[p] ? { ...found[p] } : null)
  }

  // --- 2. resolve 12-hour ambiguity before anything is measured -------------
  unwrapClock(ranges)

  // --- 3. how long is a period? --------------------------------------------
  const durations = ranges
    .filter((r): r is TimeRange & { end: number } => !!r && r.end != null && r.end > r.start)
    .map((r) => r.end - r.start)
  const starts = ranges.filter(Boolean).map((r) => r!.start)
  const startGaps: number[] = []
  for (let i = 1; i < starts.length; i++) if (starts[i] > starts[i - 1]) startGaps.push(starts[i] - starts[i - 1])
  const step = Math.min(
    MAX_STEP,
    Math.max(MIN_STEP, median(durations) ?? median(startGaps) ?? DEFAULT_STEP),
  )

  // --- 4. fill rows whose label we couldn't read ---------------------------
  const slots: Array<Slot | null> = ranges.map((r) =>
    r == null ? null : { start: r.start, end: r.end ?? r.start + step, inferred: r.end == null },
  )
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]) continue
    const prev = slots[i - 1]
    if (prev) slots[i] = { start: prev.end, end: prev.end + step, inferred: true }
  }
  // Backwards too: a run of unreadable labels at the top of the table used to
  // strand every class in those rows, because a null slot skips the whole row.
  for (let i = slots.length - 2; i >= 0; i--) {
    if (slots[i]) continue
    const next = slots[i + 1]
    if (next) slots[i] = { start: Math.max(0, next.start - step), end: next.start, inferred: true }
  }

  // --- 5. the result must tile the day ------------------------------------
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1]
    const cur = slots[i]
    if (!prev || !cur) continue
    if (cur.start < prev.end) {
      // two rows claiming the same minutes — trust the later label's start
      warnings.push(`rows ${i - 1} and ${i} overlap; trimmed to ${clock(cur.start)}`)
      prev.end = Math.max(prev.start + MIN_STEP, cur.start)
    } else if (cur.start > prev.end) {
      gaps.push({ from: prev.end, to: cur.start })
      warnings.push(`no row covers ${clock(prev.end)}–${clock(cur.start)}`)
    }
    if (cur.end <= cur.start) cur.end = cur.start + step
  }

  if (!slots.some(Boolean)) warnings.push('no time labels could be read')

  return { ys: outYs, slots, step, gaps, warnings }
}

function clock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
