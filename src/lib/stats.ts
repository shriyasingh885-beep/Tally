import type { NonClassDate, Occurrence, Timetable } from '../types'
import { occurrenceId } from './id'
import { classDatesInSemester, hasOccurrenceEnded } from './schedule'
import { fromISODate } from './time'

export type SubjectHealth = 'ok' | 'warning' | 'danger' | 'none'

export interface SubjectStat {
  subject: string
  present: number
  absent: number
  cancelled: number
  /** present + absent (completed, counted) */
  completed: number
  /** future scheduled, not cancelled */
  remaining: number
  total: number
  percentage: number | null
  target: number
  health: SubjectHealth
  /** how many of `remaining` can be skipped and still finish >= target */
  canMiss: number
  /** consecutive future attendances needed to climb back to target */
  needToAttend: number
  reachable: boolean
  message: string
}

export interface OverallStat {
  present: number
  absent: number
  cancelled: number
  completed: number
  remaining: number
  total: number
  percentage: number | null
  target: number
  health: SubjectHealth
  message: string
}

export interface StatsResult {
  overall: OverallStat
  subjects: SubjectStat[]
}

interface Tally {
  present: number
  absent: number
  cancelled: number
  remaining: number
}

function projections(t: Tally, targetPct: number) {
  const { present, absent, remaining } = t
  const completed = present + absent
  const target = targetPct / 100

  if (target >= 1) {
    // Need every class. No margin; only reachable if nothing has been missed.
    return {
      canMiss: 0,
      needToAttend: absent === 0 ? 0 : Infinity,
      reachable: absent === 0,
    }
  }

  // Max skippable future classes while ending >= target (attend the rest).
  const rawMiss = present + remaining - target * (completed + remaining)
  const canMiss = Math.max(0, Math.min(remaining, Math.floor(rawMiss + 1e-9)))

  // Consecutive future attendances needed to reach target from here.
  const rawNeed = (target * completed - present) / (1 - target)
  const needToAttend = Math.max(0, Math.ceil(rawNeed - 1e-9))

  return { canMiss, needToAttend, reachable: needToAttend <= remaining }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function subjectMessage(t: Tally, pct: number | null, targetPct: number, proj: ReturnType<typeof projections>): string {
  const completed = t.present + t.absent
  if (completed === 0) return t.remaining === 0 ? 'No classes scheduled' : 'No classes completed yet'
  if (pct !== null && t.absent === 0 && pct >= targetPct) return "You haven't missed a class"
  if (pct !== null && pct >= targetPct) {
    if (proj.canMiss > 0) return `You can miss ${plural(proj.canMiss, 'more class', 'more classes')}`
    return 'No margin left — attend every remaining class'
  }
  // below target
  if (!proj.reachable) return `${targetPct}% may not be reachable this semester`
  if (proj.needToAttend === 0) return `Attend your next class to reach ${targetPct}%`
  return `Attend the next ${plural(proj.needToAttend, 'class', 'classes')} to reach ${targetPct}%`
}

function health(pct: number | null, targetPct: number, canMiss: number): SubjectHealth {
  if (pct === null) return 'none'
  if (pct < targetPct) return 'danger'
  if (canMiss === 0) return 'warning'
  return 'ok'
}

export function computeStats(
  tt: Timetable,
  occurrences: Record<string, Occurrence>,
  nonClassDates: Record<string, NonClassDate>,
  now: Date = new Date(),
): StatsResult {
  const bySubject = new Map<string, Tally>()
  const ensure = (s: string) => {
    let v = bySubject.get(s)
    if (!v) {
      v = { present: 0, absent: 0, cancelled: 0, remaining: 0 }
      bySubject.set(s, v)
    }
    return v
  }

  for (const def of tt.classes) {
    const subject = def.subject.trim() || 'Untitled'
    const tally = ensure(subject)
    const dates = classDatesInSemester(def, tt, nonClassDates)
    for (const dISO of dates) {
      const stored = occurrences[occurrenceId(def.id, dISO)]
      if (stored?.status === 'cancelled') {
        tally.cancelled++
        continue
      }
      if (stored?.status === 'present') {
        tally.present++
        continue
      }
      if (stored?.status === 'absent') {
        tally.absent++
        continue
      }
      // unmarked — decide by clock
      if (hasOccurrenceEnded(def, fromISODate(dISO), now)) tally.absent++
      else tally.remaining++
    }
  }

  const subjects: SubjectStat[] = []
  for (const [subject, t] of bySubject) {
    const completed = t.present + t.absent
    const pct = completed === 0 ? null : (t.present / completed) * 100
    const proj = projections(t, tt.attendanceTarget)
    subjects.push({
      subject,
      present: t.present,
      absent: t.absent,
      cancelled: t.cancelled,
      completed,
      remaining: t.remaining,
      total: completed + t.remaining,
      percentage: pct,
      target: tt.attendanceTarget,
      health: health(pct, tt.attendanceTarget, proj.canMiss),
      canMiss: proj.canMiss === Infinity ? 0 : proj.canMiss,
      needToAttend: proj.needToAttend,
      reachable: proj.reachable,
      message: subjectMessage(t, pct, tt.attendanceTarget, proj),
    })
  }

  // Risk first, then lowest percentage, then name.
  const rank: Record<SubjectHealth, number> = { danger: 0, warning: 1, ok: 2, none: 3 }
  subjects.sort((a, b) => {
    if (rank[a.health] !== rank[b.health]) return rank[a.health] - rank[b.health]
    const ap = a.percentage ?? 999
    const bp = b.percentage ?? 999
    if (ap !== bp) return ap - bp
    return a.subject.localeCompare(b.subject)
  })

  const agg = subjects.reduce(
    (acc, s) => {
      acc.present += s.present
      acc.absent += s.absent
      acc.cancelled += s.cancelled
      acc.remaining += s.remaining
      return acc
    },
    { present: 0, absent: 0, cancelled: 0, remaining: 0 },
  )
  const oCompleted = agg.present + agg.absent
  const oPct = oCompleted === 0 ? null : (agg.present / oCompleted) * 100
  let oMessage: string
  if (oCompleted === 0) oMessage = 'No attendance recorded yet'
  else if (agg.absent === 0) oMessage = "You haven't missed a class."
  else if (oPct !== null && oPct >= tt.attendanceTarget) oMessage = 'On track'
  else oMessage = 'Below target'

  const overall: OverallStat = {
    present: agg.present,
    absent: agg.absent,
    cancelled: agg.cancelled,
    completed: oCompleted,
    remaining: agg.remaining,
    total: oCompleted + agg.remaining,
    percentage: oPct,
    target: tt.attendanceTarget,
    health:
      oPct === null ? 'none' : oPct < tt.attendanceTarget ? 'danger' : oPct < tt.attendanceTarget + 3 ? 'warning' : 'ok',
    message: oMessage,
  }

  return { overall, subjects }
}
