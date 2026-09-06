import type { ClassDefinition } from '../types'
import { clockToMinutes } from './time'

export interface TimeGroup {
  key: string
  startTime: string
  endTime: string
  startMin: number
  endMin: number
  classes: ClassDefinition[]
}

/**
 * Collapse classes that share an exact time range into a single group.
 *
 * A timetable routinely runs three parallel lab batches from 2–4pm. Listing
 * those as three cards each stamped "2:00 PM" wastes a screen and reads as a
 * mistake; one time heading with three entries under it says what is actually
 * true — same slot, different batch.
 */
export function groupByTime(classes: ClassDefinition[]): TimeGroup[] {
  const groups = new Map<string, TimeGroup>()

  for (const cls of classes) {
    const key = `${cls.startTime}-${cls.endTime}`
    let group = groups.get(key)
    if (!group) {
      let endMin = clockToMinutes(cls.endTime)
      const startMin = clockToMinutes(cls.startTime)
      if (endMin <= startMin) endMin += 24 * 60
      group = {
        key,
        startTime: cls.startTime,
        endTime: cls.endTime,
        startMin,
        endMin,
        classes: [],
      }
      groups.set(key, group)
    }
    group.classes.push(cls)
  }

  const ordered = [...groups.values()].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  for (const g of ordered) {
    // Within a slot, order by batch so the same batch sits in the same place
    // every day rather than jumping around with extraction order.
    g.classes.sort(
      (a, b) =>
        (a.batch ?? '').localeCompare(b.batch ?? '', undefined, { numeric: true }) ||
        a.subject.localeCompare(b.subject),
    )
  }
  return ordered
}

/**
 * Classes relevant to a batch selection.
 *
 * A class with no batch belongs to everyone (a whole-class lecture), so it
 * survives every filter. "All" keeps everything.
 */
export function filterByBatch(classes: ClassDefinition[], batch: string | null): ClassDefinition[] {
  if (!batch) return classes
  return classes.filter((c) => {
    if (!c.batch) return true
    return batchMatches(c.batch, batch)
  })
}

/**
 * Does a class's batch label cover the selected batch?
 *
 * Two things beyond an exact match matter here:
 *  - composites: a session marked "A, B" is attended by both A and B;
 *  - hierarchy: sub-batches are written as the parent plus a digit, so a
 *    lecture for "B" is attended by B1, B2 and B3, and picking the parent "B"
 *    shows everything underneath it. Without this a student filtering to B3
 *    would lose every whole-class lecture.
 */
export function batchMatches(classBatch: string, selected: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase()
  const target = norm(selected)
  const parts = classBatch.split(/[,/&+]/).map(norm).filter(Boolean)

  for (const part of parts) {
    if (part === target) return true
    if (isParentOf(part, target) || isParentOf(target, part)) return true
  }
  return false
}

/** "b" is the parent of "b3"; "it-b" is the parent of "it-b1". */
function isParentOf(parent: string, child: string): boolean {
  if (!parent || parent.length >= child.length) return false
  if (!child.startsWith(parent)) return false
  return /^\d{1,2}$/.test(child.slice(parent.length))
}

/** Every batch label a user can meaningfully filter by, composites expanded. */
export function selectableBatches(classes: ClassDefinition[]): string[] {
  const set = new Set<string>()
  for (const c of classes) {
    if (!c.batch) continue
    for (const part of c.batch.split(/[,/&+]/)) {
      const t = part.trim()
      if (t) set.add(t)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
