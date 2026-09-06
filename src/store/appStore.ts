import { create } from 'zustand'
import type {
  AppPage,
  AttendanceStatus,
  BreakPeriod,
  ClassDefinition,
  NonClassDate,
  Occurrence,
  ParseStep,
  PersistedState,
  SetupStage,
  Task,
  Timetable,
} from '../types'
import { occurrenceId, uid } from '../lib/id'
import type { PdfPage } from '../lib/parse/extractText'
import { cleanTaskTitle } from '../lib/tasks'
import { addDays, isoDate, localTimezone } from '../lib/time'
import { startOfWeek } from '../lib/schedule'
import { clearState, createSaver, loadState, STATE_VERSION } from '../lib/persist'

const PARSE_STEPS: Omit<ParseStep, 'state'>[] = [
  { key: 'read', label: 'Reading timetable' },
  { key: 'days', label: 'Identifying days' },
  { key: 'slots', label: 'Detecting time slots' },
  { key: 'subjects', label: 'Finding subjects' },
  { key: 'rooms', label: 'Detecting rooms' },
  { key: 'organize', label: 'Organizing schedule' },
]

function freshSteps(): ParseStep[] {
  return PARSE_STEPS.map((s) => ({ ...s, state: 'pending' }))
}

const THEME_KEY = 'tally:theme'

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme)
}

function readStoredTheme(): 'light' | 'dark' {
  let theme: 'light' | 'dark' = 'light'
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light') theme = stored
    else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) theme = 'dark'
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') applyTheme(theme)
  return theme
}

/** Default semester: this academic week through +15 weeks. */
function defaultSemester(): { start: string; end: string } {
  const monday = startOfWeek(new Date(), 1)
  return { start: isoDate(monday), end: isoDate(addDays(monday, 15 * 7 - 3)) }
}

interface DraftMeta {
  name: string
  timezone: string
  semesterStart: string
  semesterEnd: string
  attendanceTarget: number
}

interface AppState {
  hydrated: boolean
  storageOk: boolean

  phase: 'setup' | 'ready'
  setupStage: SetupStage
  parseSteps: ParseStep[]
  parseError: string | null
  reviewNote: string | null
  /** pages to choose between, when one PDF holds several timetables */
  pdfPages: PdfPage[]
  parseProgress: number | null

  draftClasses: ClassDefinition[]
  draftBreaks: BreakPeriod[]
  draftMeta: DraftMeta

  timetable: Timetable | null
  occurrences: Record<string, Occurrence>
  nonClassDates: Record<string, NonClassDate>
  tasks: Record<string, Task>

  page: AppPage
  weekOffset: number
  settingsOpen: boolean
  theme: 'light' | 'dark'

  hydrate: () => Promise<void>

  // setup
  offerPages: (pages: PdfPage[]) => void
  startParsing: () => void
  setStepState: (key: string, state: ParseStep['state']) => void
  setParseProgress: (pct: number | null) => void
  parsingSucceeded: (classes: ClassDefinition[], breaks?: BreakPeriod[], note?: string | null) => void
  parsingFailed: (message: string) => void
  enterManualEntry: () => void
  restartSetup: () => void

  // review draft editing
  updateDraftClass: (id: string, patch: Partial<ClassDefinition>) => void
  renameDraftSubject: (from: string, to: string) => void
  addDraftClass: (dayOfWeek?: number) => void
  removeDraftClass: (id: string) => void
  updateDraftMeta: (patch: Partial<DraftMeta>) => void

  confirmTimetable: () => void
  openTimetable: () => void

  // navigation
  setPage: (page: AppPage) => void
  nextWeek: () => void
  prevWeek: () => void
  goToday: () => void
  setSettingsOpen: (open: boolean) => void
  toggleTheme: () => void

  // attendance
  toggleAttendance: (defId: string, dateISO: string, now?: Date) => void
  setStatus: (defId: string, dateISO: string, status: AttendanceStatus, now?: Date) => void

  // to-do list
  addTask: (title: string) => void
  toggleTask: (id: string) => void
  removeTask: (id: string) => void
  clearDoneTasks: () => void

  // settings
  setAttendanceTarget: (n: number) => void
  setSemester: (startISO: string, endISO: string) => void
  /** dismiss the first-run semester prompt, keeping the dates as they are */
  skipSemesterPrompt: () => void
  /** edit one class in place; its id is kept so marked attendance stays attached */
  updateClass: (id: string, patch: Partial<ClassDefinition>) => void
  replaceClasses: (classes: ClassDefinition[]) => void
  resetTimetable: () => Promise<void>
  retrySave: () => void
}

const saver = createSaver()

function persistedSnapshot(s: AppState): PersistedState {
  return {
    version: STATE_VERSION,
    timetable: s.timetable,
    occurrences: s.occurrences,
    nonClassDates: s.nonClassDates,
    tasks: s.tasks,
  }
}

export const useApp = create<AppState>((set, get) => {
  const scheduleSave = () => saver.schedule(persistedSnapshot(get()))
  const flushSave = () => void saver.flush(persistedSnapshot(get()))

  saver.onStatus((ok) => set({ storageOk: ok }))

  return {
    hydrated: false,
    storageOk: true,

    phase: 'setup',
    setupStage: 'upload',
    parseSteps: freshSteps(),
    parseError: null,
    reviewNote: null,
    pdfPages: [],
    parseProgress: null,

    draftClasses: [],
    draftBreaks: [],
    draftMeta: {
      name: 'My Timetable',
      timezone: localTimezone(),
      ...(() => {
        const s = defaultSemester()
        return { semesterStart: s.start, semesterEnd: s.end }
      })(),
      attendanceTarget: 75,
    },

    timetable: null,
    occurrences: {},
    nonClassDates: {},
    tasks: {},

    // Mobile opens straight onto the timetable — that is what the app is for.
    // Home stays one tap away in the bottom nav.
    page: 'timetable',
    weekOffset: 0,
    settingsOpen: false,
    theme: readStoredTheme(),

    async hydrate() {
      const data = await loadState()
      if (data?.timetable) {
        set({
          timetable: data.timetable,
          occurrences: data.occurrences ?? {},
          nonClassDates: data.nonClassDates ?? {},
          tasks: data.tasks ?? {},
          phase: 'ready',
          setupStage: 'complete',
          hydrated: true,
        })
      } else {
        set({ hydrated: true })
      }
    },

    offerPages(pages) {
      set({ setupStage: 'pages', pdfPages: pages, parseError: null })
    },

    startParsing() {
      set({
        setupStage: 'parsing',
        parseSteps: freshSteps(),
        parseError: null,
        reviewNote: null,
        parseProgress: null,
      })
    },

    setStepState(key, state) {
      set((s) => ({
        parseSteps: s.parseSteps.map((st) => (st.key === key ? { ...st, state } : st)),
      }))
    },

    setParseProgress(pct) {
      set({ parseProgress: pct })
    },

    parsingSucceeded(classes, breaks = [], note = null) {
      set((s) => ({
        setupStage: 'review',
        draftClasses: classes,
        draftBreaks: breaks,
        reviewNote: note,
        parseSteps: s.parseSteps.map((st) => ({ ...st, state: 'done' })),
      }))
    },

    parsingFailed(message) {
      set({ setupStage: 'upload', parseError: message })
    },

    enterManualEntry() {
      const s = get()
      const classes = s.draftClasses.length ? s.draftClasses : []
      set({ setupStage: 'review', draftClasses: classes, parseError: null, reviewNote: null })
    },

    restartSetup() {
      set({
        setupStage: 'upload',
        parseSteps: freshSteps(),
        parseError: null,
        reviewNote: null,
        pdfPages: [],
        draftClasses: [],
        draftBreaks: [],
      })
    },

    updateDraftClass(id, patch) {
      set((s) => ({
        draftClasses: s.draftClasses.map((c) => {
          if (c.id !== id) return c
          const next = { ...c, ...patch }
          // A field the user has touched no longer needs review.
          if (next.review) {
            next.review = next.review.filter((f) => !(f in patch))
            if (!next.review.length) delete next.review
          }
          return next
        }),
      }))
    },

    /**
     * OCR gives the same subject the same wrong spelling everywhere, so fixing
     * it once should fix the lot — 8 edits instead of 30.
     */
    renameDraftSubject(from, to) {
      const a = from.trim()
      const b = to.trim()
      if (!a || !b || a === b) return
      set((s) => ({
        draftClasses: s.draftClasses.map((c) => {
          if (c.subject.trim() !== a) return c
          const next = { ...c, subject: b }
          if (next.review) {
            next.review = next.review.filter((f) => f !== 'subject')
            if (!next.review.length) delete next.review
          }
          return next
        }),
      }))
    },

    addDraftClass(dayOfWeek = 1) {
      set((s) => ({
        draftClasses: [
          ...s.draftClasses,
          {
            id: uid('cls'),
            subject: '',
            room: '',
            type: 'lecture',
            dayOfWeek,
            startTime: '09:00',
            endTime: '10:00',
            review: ['subject'],
          },
        ],
      }))
    },

    removeDraftClass(id) {
      set((s) => ({ draftClasses: s.draftClasses.filter((c) => c.id !== id) }))
    },

    updateDraftMeta(patch) {
      set((s) => ({ draftMeta: { ...s.draftMeta, ...patch } }))
    },

    confirmTimetable() {
      const s = get()
      const now = new Date().toISOString()
      const cleaned = s.draftClasses
        .map((c) => ({
          ...c,
          subject: c.subject.trim(),
          room: c.room.trim(),
          teacher: c.teacher?.trim() || undefined,
        }))
        .filter((c) => c.subject && c.dayOfWeek >= 1 && c.dayOfWeek <= 7)
      const tt: Timetable = {
        id: uid('tt'),
        name: s.draftMeta.name.trim() || 'My Timetable',
        timezone: s.draftMeta.timezone,
        weekStart: 1,
        semesterStart: s.draftMeta.semesterStart,
        semesterEnd: s.draftMeta.semesterEnd,
        attendanceTarget: s.draftMeta.attendanceTarget,
        classes: cleaned,
        breaks: s.draftBreaks,
        createdAt: now,
        updatedAt: now,
      }
      set({ timetable: tt, setupStage: 'complete' })
      flushSave()
    },

    openTimetable() {
      set({ phase: 'ready', page: 'timetable', weekOffset: 0 })
    },

    setPage(page) {
      set({ page })
    },
    nextWeek() {
      set((s) => ({ weekOffset: s.weekOffset + 1 }))
    },
    prevWeek() {
      set((s) => ({ weekOffset: s.weekOffset - 1 }))
    },
    goToday() {
      set({ weekOffset: 0 })
    },
    setSettingsOpen(open) {
      set({ settingsOpen: open })
    },
    toggleTheme() {
      set((s) => {
        const next = s.theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        try {
          localStorage.setItem(THEME_KEY, next)
        } catch {
          /* ignore */
        }
        return { theme: next }
      })
    },

    toggleAttendance(defId, dateISO) {
      const s = get()
      const key = occurrenceId(defId, dateISO)
      const current = s.occurrences[key]
      const next = { ...s.occurrences }
      if (!current || current.status === 'absent' || current.status === 'cancelled') {
        const nowIso = new Date().toISOString()
        next[key] = {
          id: key,
          classDefinitionId: defId,
          date: dateISO,
          status: 'present',
          createdAt: current?.createdAt ?? nowIso,
          updatedAt: nowIso,
        }
      } else {
        // was present -> clear (logical status reverts to unmarked / absent by clock)
        delete next[key]
      }
      set({ occurrences: next })
      flushSave()
    },

    setStatus(defId, dateISO, status) {
      const s = get()
      const key = occurrenceId(defId, dateISO)
      const next = { ...s.occurrences }
      if (status === 'unmarked') {
        delete next[key]
      } else {
        const nowIso = new Date().toISOString()
        next[key] = {
          id: key,
          classDefinitionId: defId,
          date: dateISO,
          status,
          createdAt: s.occurrences[key]?.createdAt ?? nowIso,
          updatedAt: nowIso,
        }
      }
      set({ occurrences: next })
      flushSave()
    },

    /**
     * Tasks are the user's own words, so an empty or whitespace-only title is
     * a mis-tap rather than an entry — swallow it instead of littering the list.
     */
    addTask(title) {
      const clean = cleanTaskTitle(title)
      if (!clean) return
      const id = uid('task')
      set((s) => ({
        tasks: {
          ...s.tasks,
          [id]: { id, title: clean, done: false, createdAt: new Date().toISOString() },
        },
      }))
      flushSave()
    },

    toggleTask(id) {
      set((s) => {
        const task = s.tasks[id]
        if (!task) return {}
        const done = !task.done
        return {
          tasks: {
            ...s.tasks,
            [id]: { ...task, done, completedAt: done ? new Date().toISOString() : undefined },
          },
        }
      })
      flushSave()
    },

    removeTask(id) {
      set((s) => {
        if (!s.tasks[id]) return {}
        const next = { ...s.tasks }
        delete next[id]
        return { tasks: next }
      })
      flushSave()
    },

    clearDoneTasks() {
      set((s) => {
        const next: Record<string, Task> = {}
        for (const [id, t] of Object.entries(s.tasks)) if (!t.done) next[id] = t
        return { tasks: next }
      })
      flushSave()
    },

    setAttendanceTarget(n) {
      const clamped = Math.max(1, Math.min(100, Math.round(n)))
      set((s) => (s.timetable ? { timetable: { ...s.timetable, attendanceTarget: clamped, updatedAt: new Date().toISOString() } } : {}))
      scheduleSave()
    },

    setSemester(startISO, endISO) {
      set((s) =>
        s.timetable
          ? {
              timetable: {
                ...s.timetable,
                semesterStart: startISO,
                semesterEnd: endISO,
                // setting them by hand is exactly what confirming means
                semesterConfirmed: true,
                updatedAt: new Date().toISOString(),
              },
            }
          : {},
      )
      flushSave()
    },

    skipSemesterPrompt() {
      set((s) =>
        s.timetable ? { timetable: { ...s.timetable, semesterConfirmed: true } } : {},
      )
      flushSave()
    },

    /**
     * Editing a class must never re-create it: attendance is stored against the
     * class id, so a new id would orphan every occurrence already marked. Patch
     * in place and the record survives the edit.
     */
    updateClass(id, patch) {
      set((s) => {
        if (!s.timetable) return {}
        const classes = s.timetable.classes.map((c) =>
          c.id === id
            ? {
                ...c,
                ...patch,
                subject: (patch.subject ?? c.subject).trim(),
                room: (patch.room ?? c.room).trim(),
                teacher: (patch.teacher ?? c.teacher)?.trim() || undefined,
                batch: (patch.batch ?? c.batch)?.trim() || undefined,
                // a field the user has just set is no longer a parser guess
                review: c.review?.filter((f) => !(f in patch)),
              }
            : c,
        )
        for (const c of classes) if (c.review && !c.review.length) delete c.review
        return { timetable: { ...s.timetable, classes, updatedAt: new Date().toISOString() } }
      })
      flushSave()
    },

    replaceClasses(classes) {
      set((s) =>
        s.timetable ? { timetable: { ...s.timetable, classes, updatedAt: new Date().toISOString() } } : {},
      )
      flushSave()
    },

    retrySave() {
      void saver.flush(persistedSnapshot(get()))
    },

    async resetTimetable() {
      await clearState()
      set({
        phase: 'setup',
        setupStage: 'upload',
        parseSteps: freshSteps(),
        parseError: null,
        draftClasses: [],
        draftBreaks: [],
        timetable: null,
        occurrences: {},
        nonClassDates: {},
        tasks: {},
        page: 'timetable',
        weekOffset: 0,
        settingsOpen: false,
      })
    },
  }
})
