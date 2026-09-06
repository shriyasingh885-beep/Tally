export type AttendanceStatus = 'unmarked' | 'present' | 'absent' | 'cancelled'

export type ClassType = 'lecture' | 'lab' | 'tutorial' | 'other'

/** Where an extracted class sat in the source document's grid. */
export interface SourceCell {
  /** grid row index of the cell's top edge */
  row: number
  /** grid column index (the day column) */
  col: number
  /** how many grid rows the cell merged across */
  rowSpan: number
  /** which vertical slice of a split cell this came from (0 when not split) */
  lane: number
  /** how many slices the cell was split into (1 when not split) */
  lanes: number
}

export interface ClassDefinition {
  id: string
  subject: string
  room: string
  /** Faculty initials/name as printed in the source ("PrKh, IK"). */
  teacher?: string
  /**
   * Batch / group / section this class belongs to, exactly as the source
   * writes it ("B", "B1", "IT-B3", "A, B"). Empty when the timetable has no
   * batch system at all.
   */
  batch?: string
  type: ClassType
  /** 1 = Monday … 7 = Sunday (ISO). Timetable UI shows 1–5. */
  dayOfWeek: number
  /** "HH:MM" 24-hour local wall-clock. */
  startTime: string
  /** "HH:MM" 24-hour local wall-clock. May be <= startTime when the class crosses midnight. */
  endTime: string
  /** Fields the parser was not confident about; drives the review highlight. */
  review?: string[]

  // ---- extraction provenance (absent for manually entered classes) ----
  /** 0–1. How much the parser trusts this entry as a whole. */
  confidence?: number
  /** The raw cell text this entry was derived from, before any cleanup. */
  originalText?: string
  /** Which cell of the source grid this came from. */
  sourceCell?: SourceCell
}

/**
 * A gap the timetable prints as a row of its own — lunch, recess, a tea break.
 *
 * Not a ClassDefinition: nobody takes attendance at lunch, and letting one into
 * the class list would drag it into every percentage on the attendance page. It
 * is a marker on the day, and every day gets it, which is how timetables draw
 * them: one band straight across all the columns.
 */
export interface BreakPeriod {
  id: string
  /** as printed, tidied — "Lunch break", "Break" */
  label: string
  /** "HH:MM" 24-hour local wall-clock */
  startTime: string
  endTime: string
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
  /**
   * True once the user has actually seen the semester dates, rather than
   * inheriting the guess made at setup. Absent on timetables saved before the
   * prompt existed, which is why they get asked once.
   */
  semesterConfirmed?: boolean
  classes: ClassDefinition[]
  /** absent on timetables saved before breaks existed */
  breaks?: BreakPeriod[]
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

/**
 * A to-do the user wrote themselves, alongside the classes the timetable
 * supplies. Deliberately just a line of text and a tick: a list you can fill in
 * two taps gets used, and a form with due dates and subject tags does not.
 */
export interface Task {
  id: string
  title: string
  done: boolean
  /** ISO timestamp — orders the list, and survives an edit to the title */
  createdAt: string
  /** ISO timestamp of the tick, so recently finished work sits at the top */
  completedAt?: string
}

export type AppPage = 'home' | 'timetable' | 'attendance'

export type SetupStage = 'upload' | 'pages' | 'parsing' | 'review' | 'complete'

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
  /** optional: absent from anything written before tasks existed */
  tasks?: Record<string, Task>
}
