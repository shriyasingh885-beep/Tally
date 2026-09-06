import type { ClassDefinition } from '../../types'
import { clockToMinutes } from '../time'
import type { Corpus, RawCell } from './cellModel'

export interface ValidationIssue {
  classId: string
  field: string
  message: string
}

export interface ValidationResult {
  classes: ClassDefinition[]
  issues: ValidationIssue[]
  /** entries dropped outright as impossible */
  dropped: number
}

/**
 * How much to trust one extracted entry. Anything below ~0.6 gets flagged for
 * review rather than presented as fact — the parser should never look
 * confident about something it guessed.
 */
export function scoreConfidence(
  cls: ClassDefinition,
  cell: RawCell,
  corpus: Corpus,
  subjectCounts: Map<string, number>,
): number {
  let score = 1

  score *= 0.55 + 0.45 * Math.min(1, cell.ocrConfidence)

  // a time label we had to infer from neighbours is weaker than one we read
  if (cell.timeInferred) score -= 0.15

  // a subject nobody else in the document shares is more likely a misread
  const seen = subjectCounts.get(cls.subject.toLowerCase()) ?? 0
  if (seen <= 1) score -= 0.1

  if (cls.subject.replace(/[^A-Za-z]/g, '').length < 3) score -= 0.25
  // rooms are near-universal in this document but missing here
  if (!cls.room && corpus.roomCoverage > 0.6) score -= 0.12
  if (corpus.hasBatchSystem && !cls.batch) score -= 0.1

  // text that is mostly non-letters is OCR debris
  const letters = cls.subject.replace(/[^A-Za-z]/g, '').length
  if (cls.subject.length && letters / cls.subject.length < 0.6) score -= 0.2

  return Math.max(0, Math.min(1, score))
}

const MIN_DURATION = 10
const MAX_DURATION = 8 * 60

/**
 * Spatial and semantic sanity pass. Drops entries that cannot be real, flags
 * the ones that look off, and de-duplicates without ever collapsing two
 * batches that genuinely share a time slot.
 */
export function validateClasses(
  classes: ClassDefinition[],
  cellById: Map<string, RawCell>,
  corpus: Corpus,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const kept: ClassDefinition[] = []
  let dropped = 0

  const seenKeys = new Set<string>()

  for (const cls of classes) {
    const cell = cellById.get(cls.id)
    const start = clockToMinutes(cls.startTime)
    let end = clockToMinutes(cls.endTime)
    if (end <= start) end += 24 * 60
    const duration = end - start

    if (cls.dayOfWeek < 1 || cls.dayOfWeek > 7) {
      dropped++
      continue
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || duration < MIN_DURATION || duration > MAX_DURATION) {
      dropped++
      continue
    }
    if (!cls.subject.trim()) {
      dropped++
      continue
    }

    // Two entries identical in every meaningful field are a duplicate. Same
    // slot but a different batch/subject/room is legitimate and must survive.
    const key = [cls.dayOfWeek, cls.startTime, cls.endTime, cls.subject.toLowerCase(), cls.batch ?? '', cls.room].join('|')
    if (seenKeys.has(key)) {
      dropped++
      continue
    }
    seenKeys.add(key)

    // The rendered duration must match the cell the text physically occupied.
    if (cell) {
      const cellDuration = cell.endMin - cell.startMin
      if (cellDuration > 0 && Math.abs(cellDuration - duration) > 5) {
        issues.push({
          classId: cls.id,
          field: 'endTime',
          message: `duration ${duration}m does not match its ${cellDuration}m cell`,
        })
      }
    }

    if (corpus.hasBatchSystem && !cls.batch) {
      issues.push({ classId: cls.id, field: 'batch', message: 'no batch found in a batched timetable' })
    }
    // A room label sitting in the batch field means the classifier slipped.
    if (cls.batch && /\d{2,}/.test(cls.batch)) {
      issues.push({ classId: cls.id, field: 'batch', message: 'batch looks like a room number' })
    }

    kept.push(cls)
  }

  // Same day+time+batch twice is a collapse/duplication smell worth surfacing.
  const slotBatch = new Map<string, ClassDefinition[]>()
  for (const c of kept) {
    if (!c.batch) continue
    const k = `${c.dayOfWeek}|${c.startTime}|${c.batch}`
    const list = slotBatch.get(k) ?? []
    list.push(c)
    slotBatch.set(k, list)
  }
  for (const [, list] of slotBatch) {
    if (list.length > 1) {
      for (const c of list) {
        issues.push({ classId: c.id, field: 'batch', message: 'same batch booked twice in one slot' })
      }
    }
  }

  return { classes: kept, issues, dropped }
}

/** Unique batch identifiers present in a set of classes, in source spelling. */
export function batchesOf(classes: ClassDefinition[]): string[] {
  const set = new Set<string>()
  for (const c of classes) if (c.batch) set.add(c.batch)
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
