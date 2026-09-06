import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import { occurrenceId } from '../lib/id'
import { occurrenceDisplay } from '../lib/occurrenceDisplay'
import { getWeekDays, withinSemester } from '../lib/schedule'
import { clockToMinutes, isoDate, isoWeekday, minutesToLabel } from '../lib/time'
import { dowShort } from '../lib/format'
import { filterByBatch, groupByTime, selectableBatches } from '../lib/groupClasses'
import { withBreaks } from '../lib/breaks'
import { IconMoreVertical, IconSearch, IconX } from '../components/icons'
import { AgendaCard } from './AgendaCard'
import { ThemeToggle } from '../components/ThemeToggle'
import { useSwipe } from '../hooks/useSwipe'

interface Props {
  now: Date
  onContext: (defId: string, dateISO: string, x: number, y: number) => void
  onOpenSettings: (anchor: DOMRect) => void
}

export function MobileTimetable({ now, onContext, onOpenSettings }: Props) {
  const timetable = useApp((s) => s.timetable)!
  const occurrences = useApp((s) => s.occurrences)
  const toggleAttendance = useApp((s) => s.toggleAttendance)

  const [selectedDow, setSelectedDow] = useState(() => {
    const d = isoWeekday(now)
    return d >= 1 && d <= 5 ? d : 1
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [batch, setBatch] = useState<string | null>(null)

  const days = useMemo(() => getWeekDays(0, 1, 5, now), [now])
  const selectedDate = days[selectedDow - 1]
  const dISO = isoDate(selectedDate)
  const inSem = withinSemester(dISO, timetable)

  // Only offer a batch filter when this timetable actually has batches.
  const batches = useMemo(() => selectableBatches(timetable.classes), [timetable.classes])
  useEffect(() => {
    if (batch && !batches.includes(batch)) setBatch(null)
  }, [batches, batch])

  const groups = useMemo(() => {
    let list = timetable.classes.filter((c) => c.dayOfWeek === selectedDow)
    list = filterByBatch(list, batch)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.room.toLowerCase().includes(q) ||
          (c.batch ?? '').toLowerCase().includes(q),
      )
    }
    return groupByTime(list)
  }, [timetable.classes, selectedDow, search, batch])

  // Lunch sits in the running order rather than leaving an unexplained hole
  // between the noon class and the two o'clock one.
  const rows = useMemo(() => withBreaks(groups, timetable.breaks), [groups, timetable.breaks])

  // Thumb through the week the way you would a photo album. Clamped rather than
  // wrapping: running off Friday into Monday reads as a glitch, and the day
  // pills are right there for a jump across the week.
  const swipe = useSwipe({
    onLeft: () => setSelectedDow((d) => Math.min(5, d + 1)),
    onRight: () => setSelectedDow((d) => Math.max(1, d - 1)),
  })

  const viewFor = (defId: string) => {
    const def = timetable.classes.find((c) => c.id === defId)!
    const stored = occurrences[occurrenceId(def.id, dISO)]
    const { display, ended, live, userSet } = occurrenceDisplay(def, selectedDate, stored, now, inSem)
    return { def, dateISO: dISO, display, live, ended, userSet }
  }

  return (
    <div className="m-page m-timetable" {...swipe}>
      <header className="m-topbar">
        <h1>Timetable</h1>
        <div className="m-topbar-actions">
          <ThemeToggle />
          <button
            className="icon-btn"
            aria-label={searchOpen ? 'Close search' : 'Search'}
            onClick={() => {
              setSearchOpen((o) => !o)
              setSearch('')
            }}
          >
            {searchOpen ? <IconX width={19} height={19} /> : <IconSearch width={19} height={19} />}
          </button>
          <button
            className="icon-btn"
            aria-label="More"
            onClick={(e) => onOpenSettings((e.currentTarget as HTMLElement).getBoundingClientRect())}
          >
            <IconMoreVertical width={19} height={19} />
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="m-search">
          <input
            autoFocus
            placeholder="Search subject, room or batch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      <div className="m-day-pills">
        {days.map((d, i) => {
          const dow = i + 1
          return (
            <button
              key={dow}
              className={`m-day-pill${dow === selectedDow ? ' active' : ''}`}
              onClick={() => setSelectedDow(dow)}
            >
              <span className="pd-dow">{dowShort(d).slice(0, 3)}</span>
              <span className="pd-date">{d.getDate()}</span>
            </button>
          )
        })}
      </div>

      {batches.length > 1 && (
        <div className="batch-filter" role="group" aria-label="Filter by batch">
          <button className={`batch-chip${batch === null ? ' active' : ''}`} onClick={() => setBatch(null)}>
            All
          </button>
          {batches.map((b) => (
            <button
              key={b}
              className={`batch-chip${batch === b ? ' active' : ''}`}
              onClick={() => setBatch(b)}
              aria-pressed={batch === b}
            >
              {b}
            </button>
          ))}
        </div>
      )}

      <div className="agenda-list">
        {groups.length === 0 ? (
          <div className="agenda-empty">
            {search || batch ? 'No matching classes.' : 'No classes today'}
          </div>
        ) : (
          rows.map((row) =>
            row.kind === 'break' ? (
              <div className="break-row" key={row.brk.id}>
                <span className="break-line" aria-hidden="true" />
                <span className="break-text">{row.brk.label}</span>
                <span className="break-line" aria-hidden="true" />
              </div>
            ) : (() => {
              const group = row.item
              return group.classes.length === 1 ? (
              // A lone class carries its own time — no heading needed.
              <div className="agenda-single" key={group.key}>
                <AgendaCard
                  view={viewFor(group.classes[0].id)}
                  showTime
                  onToggle={toggleAttendance}
                  onContext={onContext}
                />
              </div>
            ) : (
              // Parallel batches share one time heading instead of repeating it.
              <section className="time-group" key={group.key}>
                <h2 className="tg-time">
                  {minutesToLabel(clockToMinutes(group.startTime))} –{' '}
                  {minutesToLabel(clockToMinutes(group.endTime))}
                </h2>
                <div className="tg-classes">
                  {group.classes.map((c) => (
                    <AgendaCard
                      key={c.id}
                      view={viewFor(c.id)}
                      onToggle={toggleAttendance}
                      onContext={onContext}
                    />
                  ))}
                </div>
              </section>
              )
            })(),
          )
        )}
      </div>
    </div>
  )
}
