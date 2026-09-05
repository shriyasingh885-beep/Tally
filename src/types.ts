export type AttendanceStatus = 'unmarked' | 'present' | 'absent' | 'cancelled'

export type ClassType = 'lecture' | 'lab' | 'tutorial' | 'other'

export interface ClassDefinition {
  id: string
  subject: string
  room: string
  teacher?: string
  type: ClassType
  /** 1 = Monday … 7 = Sunday (ISO). Timetable UI shows 1–5. */
  dayOfWeek: number
  /** "HH:MM" 24-hour local wall-clock. */
  startTime: string
  /** "HH:MM" 24-hour local wall-clock. May be <= startTime when the class crosses midnight. */
  endTime: string
  /** Fields the parser was not confident about; drives the review highlight. */
  review?: string[]
}

export interface Timetable {
  id: string
  name: string
  /** IANA timezone; defaults to the browser's. */
  timezone: string
  /** ISO weekday the academic week starts on (1 = Monday). */
  weekStart: number
  /** yyyy-mm-dd — first day classes are counted from. */
  semesterStart: string
  /** yyyy-mm-dd — last day classes are counted through. */
  semesterEnd: string
  /** Minimum attendance target as a percentage (default 75). */
  attendanceTarget: number
  classes: ClassDefinition[]
  createdAt: string
  updatedAt: string
}

/**
 * A single dated instance of a class. Only occurrences the user has actively
 * changed (present / absent / cancelled) are persisted — everything else is
 * derived from the timetable definition + the current time.
 */
export interface Occurrence {
  id: string
  classDefinitionId: string
  /** yyyy-mm-dd (local). */
  date: string
  status: Exclude<AttendanceStatus, 'unmarked'>
  createdAt: string
  updatedAt: string
}

export interface NonClassDate {
  /** yyyy-mm-dd */
  date: string
  reason?: string
}

export type AppPage = 'home' | 'timetable' | 'attendance'

export type SetupStage = 'upload' | 'parsing' | 'review' | 'complete'

export interface ParseStep {
  key: string
  label: string
  state: 'pending' | 'active' | 'done'
}

export interface PersistedState {
  version: number
  timetable: Timetable | null
  occurrences: Record<string, Occurrence>
  nonClassDates: Record<string, NonClassDate>
}
