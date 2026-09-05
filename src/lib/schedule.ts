import type { ClassDefinition, Timetable } from '../types'
import { addDays, clockToMinutes, fromISODate, isoDate, isoWeekday } from './time'

/** Monday-anchored start of the week containing `date` (weekStartDay: 1 = Mon). */
export function startOfWeek(date: Date, weekStartDay = 1): Date {
  const wd = isoWeekday(date)
  let diff = wd - weekStartDay
  if (diff < 0) diff += 7
  const d = addDays(date, -diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Array of Date objects for the visible timetable week. `weekOffset` 0 = current week. */
export function getWeekDays(
  weekOffset: number,
  weekStartDay = 1,
  count = 5,
  reference: Date = new Date(),
): Date[] {
  const base = startOfWeek(reference, weekStartDay)
  const monday = addDays(base, weekOffset * 7)
  return Array.from({ length: count }, (_, i) => addDays(monday, i))
}

export function occurrenceStart(def: ClassDefinition, date: Date): Date {
  const d = new Date(date)
  const mins = clockToMinutes(def.startTime)
  d.setHours(0, 0, 0, 0)
  d.setMinutes(mins)
  return d
}

export function occurrenceEnd(def: ClassDefinition, date: Date): Date {
  const startMin = clockToMinutes(def.startTime)
  const endMin = clockToMinutes(def.endTime)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  if (endMin <= startMin) {
    // Crosses midnight — end is on the following day.
    d.setDate(d.getDate() + 1)
  }
  d.setMinutes(endMin)
  return d
}

export function hasOccurrenceEnded(def: ClassDefinition, date: Date, now: Date): boolean {
  return now.getTime() >= occurrenceEnd(def, date).getTime()
}

export function isOccurrenceLive(def: ClassDefinition, date: Date, now: Date): boolean {
  const t = now.getTime()
  return t >= occurrenceStart(def, date).getTime() && t < occurrenceEnd(def, date).getTime()
}

export function withinSemester(dateISO: string, tt: Timetable): boolean {
  return dateISO >= tt.semesterStart && dateISO <= tt.semesterEnd
}

/**
 * Every date (yyyy-mm-dd) a class definition occurs on within the semester,
 * excluding the supplied non-class dates.
 */
export function classDatesInSemester(
  def: ClassDefinition,
  tt: Timetable,
  nonClassDates: Record<string, unknown>,
): string[] {
  const out: string[] = []
  let cur = fromISODate(tt.semesterStart)
  const end = fromISODate(tt.semesterEnd)
  // Advance to the first matching weekday.
  while (cur.getTime() <= end.getTime() && isoWeekday(cur) !== def.dayOfWeek) {
    cur = addDays(cur, 1)
  }
  while (cur.getTime() <= end.getTime()) {
    const key = isoDate(cur)
    if (!nonClassDates[key]) out.push(key)
    cur = addDays(cur, 7)
  }
  return out
}

export interface PositionedClass {
  def: ClassDefinition
  /** minutes past midnight */
  startMin: number
  endMin: number
  /** column index among overlapping siblings, and total columns */
  lane: number
  lanes: number
}

/** Lay out a day's classes, splitting overlapping ones into side-by-side lanes. */
export function layoutDay(defs: ClassDefinition[]): PositionedClass[] {
  const items = defs
    .map((def) => {
      const startMin = clockToMinutes(def.startTime)
      let endMin = clockToMinutes(def.endTime)
      if (endMin <= startMin) endMin += 1440
      return { def, startMin, endMin, lane: 0, lanes: 1 }
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  // Greedy interval graph colouring within each overlapping cluster.
  let cluster: typeof items = []
  let clusterEnd = -1
  const flush = () => {
    if (!cluster.length) return
    const laneEnds: number[] = []
    for (const it of cluster) {
      let placed = false
      for (let i = 0; i < laneEnds.length; i++) {
        if (it.startMin >= laneEnds[i]) {
          it.lane = i
          laneEnds[i] = it.endMin
          placed = true
          break
        }
      }
      if (!placed) {
        it.lane = laneEnds.length
        laneEnds.push(it.endMin)
      }
    }
    const lanes = laneEnds.length
    for (const it of cluster) it.lanes = lanes
    cluster = []
  }
  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  flush()
  return items
}

export function dayBounds(defs: ClassDefinition[]): { min: number; max: number } {
  if (!defs.length) return { min: 8 * 60, max: 17 * 60 }
  let min = Infinity
  let max = -Infinity
  for (const d of defs) {
    const s = clockToMinutes(d.startTime)
    let e = clockToMinutes(d.endTime)
    if (e <= s) e += 1440
    min = Math.min(min, s)
    max = Math.max(max, e)
  }
  return { min, max }
}
