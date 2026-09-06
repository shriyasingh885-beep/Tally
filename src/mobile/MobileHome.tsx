import { useMemo, useState, type FormEvent } from 'react'
import { useApp } from '../store/appStore'
import { occurrenceId } from '../lib/id'
import { occurrenceDisplay, type DisplayStatus } from '../lib/occurrenceDisplay'
import { withinSemester } from '../lib/schedule'
import { clockToMinutes, isoDate, isoWeekday, minutesToLabel } from '../lib/time'
import { countDone, sortTasks } from '../lib/tasks'
import { subjectIcon, subjectStyle } from '../lib/subjectColor'
import { IconCheck, IconPlus, IconSettings, IconTrash } from '../components/icons'
import { useTapOrLongPress } from '../hooks/useTapOrLongPress'
import type { AppPage, ClassDefinition, Task } from '../types'

interface Props {
  now: Date
  onNavigate: (page: AppPage) => void
  onOpenSettings: (anchor: DOMRect) => void
  onContext: (defId: string, dateISO: string, x: number, y: number) => void
}

function greeting(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * One arc for the whole day — classes marked plus tasks ticked. A single figure
 * is the point of a to-do list: it answers "am I done?" before you read a word.
 */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const R = 21
  const CIRC = 2 * Math.PI * R
  const pct = total ? done / total : 0
  return (
    <div className="td-ring" role="img" aria-label={`${done} of ${total} done today`}>
      <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
        <circle className="td-ring-track" cx="27" cy="27" r={R} />
        <circle
          className="td-ring-fill"
          cx="27"
          cy="27"
          r={R}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - pct)}
        />
      </svg>
      <span className="td-ring-num">
        {done}
        <i>/{total}</i>
      </span>
    </div>
  )
}

interface ClassRowProps {
  def: ClassDefinition
  dateISO: string
  display: DisplayStatus
  live: boolean
  userSet: boolean
  onToggle: (defId: string, dateISO: string) => void
  onContext: (defId: string, dateISO: string, x: number, y: number) => void
}

function ClassRow({ def, dateISO, display, live, userSet, onToggle, onContext }: ClassRowProps) {
  const press = useTapOrLongPress({
    onTap: () => onToggle(def.id, dateISO),
    onLongPress: (x, y) => onContext(def.id, dateISO, x, y),
  })
  const style = subjectStyle(def.subject || 'Untitled')
  const Icon = subjectIcon(def.subject || '')
  // Compact labels ("9 AM", not "9:00 AM") so the room still fits on a phone
  const time = `${minutesToLabel(clockToMinutes(def.startTime), { withMinutes: false })} – ${minutesToLabel(
    clockToMinutes(def.endTime),
    { withMinutes: false },
  )}`
  const missed = display === 'absent' && userSet
  const state =
    display === 'present'
      ? 'present'
      : missed
        ? 'marked absent'
        : display === 'cancelled'
          ? 'cancelled'
          : 'not marked'

  return (
    <li
      className={[
        'td-row',
        display === 'present' && 'done',
        missed && 'missed',
        display === 'cancelled' && 'off',
        live && 'live',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="td-row-btn"
        aria-pressed={display === 'present'}
        aria-label={`${def.subject || 'Untitled class'}, ${time}, ${state}`}
        {...press}
      >
        <span className="td-box" aria-hidden="true">
          {display === 'present' && <IconCheck width={13} height={13} />}
        </span>
        <span className="td-row-text">
          <span className="td-row-title">{def.subject || 'Untitled'}</span>
          <span className="td-row-meta">
            <span className="td-time">{time}</span>
            {def.batch && <span className="td-chip">{def.batch}</span>}
            {def.room && <span className="td-room">{def.room}</span>}
          </span>
        </span>
        <span className="td-row-tail" aria-hidden="true">
          {live ? (
            <span className="td-live">Now</span>
          ) : (
            <span className="td-subj-ico" style={{ background: style.bg, color: style.ink }}>
              <Icon width={14} height={14} />
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

interface TaskRowProps {
  task: Task
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}

function TaskRow({ task, onToggle, onRemove }: TaskRowProps) {
  return (
    <li className={`td-row task${task.done ? ' done' : ''}`}>
      <button
        type="button"
        className="td-row-btn"
        aria-pressed={task.done}
        aria-label={task.title}
        onClick={() => onToggle(task.id)}
      >
        <span className="td-box" aria-hidden="true">
          {task.done && <IconCheck width={13} height={13} />}
        </span>
        <span className="td-row-text">
          <span className="td-row-title">{task.title}</span>
        </span>
      </button>
      <button
        type="button"
        className="td-del"
        aria-label={`Delete ${task.title}`}
        onClick={() => onRemove(task.id)}
      >
        <IconTrash width={15} height={15} />
      </button>
    </li>
  )
}

export function MobileHome({ now, onNavigate, onOpenSettings, onContext }: Props) {
  const timetable = useApp((s) => s.timetable)!
  const occurrences = useApp((s) => s.occurrences)
  const toggleAttendance = useApp((s) => s.toggleAttendance)
  const tasksById = useApp((s) => s.tasks)
  const addTask = useApp((s) => s.addTask)
  const toggleTask = useApp((s) => s.toggleTask)
  const removeTask = useApp((s) => s.removeTask)
  const clearDoneTasks = useApp((s) => s.clearDoneTasks)

  const [draft, setDraft] = useState('')

  const dISO = isoDate(now)
  const inSem = withinSemester(dISO, timetable)
  const dow = isoWeekday(now)

  // Today's classes, earliest first. Parallel lab batches all appear — each row
  // carries its batch chip so you can pick out your own.
  const todays = useMemo(
    () =>
      timetable.classes
        .filter((c) => c.dayOfWeek === dow)
        .map((def) => {
          const stored = occurrences[occurrenceId(def.id, dISO)]
          const { display, live, userSet } = occurrenceDisplay(def, now, stored, now, inSem)
          return { def, display, live, userSet }
        })
        .sort((a, b) => clockToMinutes(a.def.startTime) - clockToMinutes(b.def.startTime)),
    [timetable.classes, dow, occurrences, dISO, now, inSem],
  )

  const tasks = useMemo(() => sortTasks(Object.values(tasksById)), [tasksById])
  const tasksDone = countDone(tasks)
  const classesMarked = todays.filter((t) => t.userSet).length

  const total = todays.length + tasks.length
  const done = classesMarked + tasksDone

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    addTask(draft)
    setDraft('')
  }

  return (
    <div className="m-page m-home">
      <header className="m-topbar">
        <span className="brand">
          Tally<span className="dot">.</span>
        </span>
        <button
          className="icon-btn"
          aria-label="Settings"
          onClick={(e) => onOpenSettings((e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          <IconSettings width={19} height={19} />
        </button>
      </header>

      <section className="td-hero">
        <div className="td-hero-text">
          <p className="td-hello">{greeting(now)}</p>
          <h1>{dateLabel}</h1>
          <p className="td-sub">
            {total === 0
              ? 'Nothing on today.'
              : done === total
                ? 'All done. Go and enjoy it.'
                : `${total - done} left to go`}
          </p>
        </div>
        {total > 0 && <ProgressRing done={done} total={total} />}
      </section>

      <section className="td-section">
        <div className="td-head">
          <h2>Today&rsquo;s classes</h2>
          {todays.length > 0 && (
            <span className="td-count">
              {classesMarked}/{todays.length}
            </span>
          )}
        </div>
        {todays.length === 0 ? (
          <p className="td-empty">
            No classes today.{' '}
            <button className="link-btn" onClick={() => onNavigate('timetable')}>
              See the week
            </button>
          </p>
        ) : (
          <>
            <ul className="td-list">
              {todays.map(({ def, display, live, userSet }) => (
                <ClassRow
                  key={def.id}
                  def={def}
                  dateISO={dISO}
                  display={display}
                  live={live}
                  userSet={userSet}
                  onToggle={toggleAttendance}
                  onContext={onContext}
                />
              ))}
            </ul>
            <p className="td-hint">Tap to mark present · hold for more</p>
          </>
        )}
      </section>

      <section className="td-section">
        <div className="td-head">
          <h2>My tasks</h2>
          {tasksDone > 0 && (
            <button className="td-clear" onClick={clearDoneTasks}>
              Clear done
            </button>
          )}
        </div>

        <form className="td-add" onSubmit={submit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task&hellip;"
            aria-label="New task"
            maxLength={140}
          />
          <button type="submit" aria-label="Add task" disabled={!draft.trim()}>
            <IconPlus width={17} height={17} />
          </button>
        </form>

        {tasks.length === 0 ? (
          <p className="td-empty">Nothing here yet — add an assignment or something to revise.</p>
        ) : (
          <ul className="td-list">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={toggleTask} onRemove={removeTask} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
