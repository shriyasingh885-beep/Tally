import type { ClassDefinition, Occurrence } from '../types'
import { hasOccurrenceEnded, isOccurrenceLive } from './schedule'

export type DisplayStatus = 'unmarked' | 'present' | 'absent' | 'cancelled'

export interface OccurrenceDisplay {
  display: DisplayStatus
  ended: boolean
  live: boolean
  /** the status came from an explicit user action, not derived from the clock */
  userSet: boolean
}

/**
 * The single source of truth for "what does this class cell look like right
 * now" — shared by the desktop grid and the mobile agenda so a class never
 * shows a different attendance state depending on which screen you're on.
 */
export function occurrenceDisplay(
  def: ClassDefinition,
  date: Date,
  stored: Occurrence | undefined,
  now: Date,
  inSemester: boolean,
): OccurrenceDisplay {
  const ended = hasOccurrenceEnded(def, date, now)
  const live = inSemester && isOccurrenceLive(def, date, now)

  let display: DisplayStatus = 'unmarked'
  if (!inSemester) display = 'unmarked'
  else if (stored?.status === 'present') display = 'present'
  else if (stored?.status === 'cancelled') display = 'cancelled'
  else if (stored?.status === 'absent') display = 'absent'
  else if (ended) display = 'absent'

  return { display, ended, live, userSet: !!stored }
}
