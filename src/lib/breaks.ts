import type { BreakPeriod, ClassDefinition } from '../types'
import { clockToMinutes } from './time'

/**
 * Telling a break apart from a class.
 *
 * Timetables print lunch as a row like any other, so extraction happily reads
 * "LUNCH BREAK" as a subject and files it next to Applied Physics — where it
 * then gets an attendance checkbox and drags down the percentage for a meal.
 * A break is a marker on the day, not something you attend.
 *
 * The test is deliberately whole-label rather than substring: a subject called
 * "Breaking Systems" or "Circuit Breakers" is a real class, and matching on the
 * word alone would quietly delete it from someone's timetable.
 */
const BREAK_RE =
  /^(?:(?:lunch|tea|coffee|snack|morning|afternoon|evening|short|long)\s+)?(?:break|recess|interval)$|^lunch$/i

function normalise(text: string): string {
  return text
    .replace(/[^A-Za-z\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isBreakLabel(text: string): boolean {
  const n = normalise(text)
  if (!n) return false
  return BREAK_RE.test(n)
}

/** "LUNCH BREAK" → "Lunch break"; keeps what the document called it. */
export function breakLabel(text: string): string {
  const n = normalise(text).toLowerCase()
  if (!n) return 'Break'
  return n.charAt(0).toUpperCase() + n.slice(1)
}

/**
 * One entry per distinct time range. A break row spans every day column, so
 * extraction sees it once per column and would otherwise stack five identical
 * lunches on top of each other.
 */
export function dedupeBreaks(breaks: BreakPeriod[]): BreakPeriod[] {
  const byRange = new Map<string, BreakPeriod>()
  for (const b of breaks) {
    const key = `${b.startTime}-${b.endTime}`
    if (!byRange.has(key)) byRange.set(key, b)
  }
  return [...byRange.values()].sort((a, b) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime))
}

export interface BreakRow {
  kind: 'break'
  brk: BreakPeriod
  startMin: number
  endMin: number
}

/**
 * Drop breaks into a day's running order, so a list of classes reads the way
 * the day is actually shaped rather than jumping from noon to two o'clock with
 * no explanation.
 *
 * A break with no class on either side of it is left out: an empty afternoon
 * does not need to announce its lunch.
 */
export function withBreaks<T extends { startMin: number; endMin: number }>(
  items: T[],
  breaks: BreakPeriod[] | undefined,
): Array<{ kind: 'item'; item: T; startMin: number; endMin: number } | BreakRow> {
  const rows = items
    .map((item) => ({ kind: 'item' as const, item, startMin: item.startMin, endMin: item.endMin }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  if (!breaks?.length || !rows.length) return rows

  const dayStart = rows[0].startMin
  const dayEnd = Math.max(...rows.map((r) => r.endMin))

  const bands: BreakRow[] = []
  for (const brk of breaks) {
    const startMin = clockToMinutes(brk.startTime)
    let endMin = clockToMinutes(brk.endTime)
    if (endMin <= startMin) endMin += 24 * 60
    // only show a break the day actually runs through
    if (endMin <= dayStart || startMin >= dayEnd) continue
    bands.push({ kind: 'break', brk, startMin, endMin })
  }

  return [...rows, ...bands].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
}

/** Breaks that fall inside the span a grid is drawing, for a full-width band. */
export function visibleBreaks(
  breaks: BreakPeriod[] | undefined,
  minMin: number,
  maxMin: number,
): BreakRow[] {
  if (!breaks?.length) return []
  const out: BreakRow[] = []
  for (const brk of breaks) {
    const startMin = clockToMinutes(brk.startTime)
    let endMin = clockToMinutes(brk.endTime)
    if (endMin <= startMin) endMin += 24 * 60
    if (endMin <= minMin || startMin >= maxMin) continue
    out.push({ kind: 'break', brk, startMin: Math.max(startMin, minMin), endMin: Math.min(endMin, maxMin) })
  }
  return out.sort((a, b) => a.startMin - b.startMin)
}

/** A break must not also be sitting in the class list. */
export function stripBreakClasses(classes: ClassDefinition[]): ClassDefinition[] {
  return classes.filter((c) => !isBreakLabel(c.subject))
}
