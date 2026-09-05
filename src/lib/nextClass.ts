import type { ClassDefinition, Timetable } from '../types'
import { addDays, clockToMinutes, isoDate, isoWeekday, minutesToLabel } from './time'
import { isOccurrenceLive, occurrenceStart, withinSemester } from './schedule'

export interface NextClassInfo {
  kind: 'none' | 'today' | 'later'
  def?: ClassDefinition
  date?: Date
  when: string
  minutesUntil?: number
  live?: boolean
}

/** The next class to attend — today if one remains, otherwise the next scheduled day. */
export function computeNextClass(timetable: Timetable, now: Date): NextClassInfo {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const todayDow = isoWeekday(now)

  const todays = timetable.classes
    .filter((c) => c.dayOfWeek === todayDow)
    .sort((a, b) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime))

  if (withinSemester(isoDate(now), timetable)) {
    const live = todays.find((c) => isOccurrenceLive(c, now, now))
    if (live) {
      return {
        kind: 'today',
        def: live,
        date: now,
        when: minutesToLabel(clockToMinutes(live.startTime)),
        minutesUntil: 0,
        live: true,
      }
    }
    const upcoming = todays.find((c) => clockToMinutes(c.startTime) > nowMin)
    if (upcoming) {
      const start = occurrenceStart(upcoming, now)
      return {
        kind: 'today',
        def: upcoming,
        date: now,
        when: minutesToLabel(clockToMinutes(upcoming.startTime)),
        minutesUntil: Math.round((start.getTime() - now.getTime()) / 60000),
        live: false,
      }
    }
  }

  for (let i = 1; i <= 7; i++) {
    const d = addDays(now, i)
    if (!withinSemester(isoDate(d), timetable)) continue
    const dow = isoWeekday(d)
    const first = timetable.classes
      .filter((c) => c.dayOfWeek === dow)
      .sort((a, b) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime))[0]
    if (first) {
      const dayName = i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' })
      return {
        kind: 'later',
        def: first,
        date: d,
        when: `${dayName} · ${minutesToLabel(clockToMinutes(first.startTime))}`,
      }
    }
  }
  return { kind: 'none', when: '' }
}
