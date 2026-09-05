import { useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import { occurrenceId } from '../lib/id'
import { occurrenceDisplay } from '../lib/occurrenceDisplay'
import { getWeekDays, withinSemester } from '../lib/schedule'
import { clockToMinutes, isoDate, isoWeekday } from '../lib/time'
import { dowShort } from '../lib/format'
import { IconMoreVertical, IconSearch, IconX } from '../components/icons'
import { AgendaCard } from './AgendaCard'

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

  // Weekends have no Mon–Fri classes of their own — jump ahead to the coming
  // week rather than stranding the user on a week that's entirely over.
  const weekOffset = isoWeekday(now) > 5 ? 1 : 0
  const days = useMemo(() => getWeekDays(weekOffset, 1, 5, now), [weekOffset, now])
  const selectedDate = days[selectedDow - 1]
  const dISO = isoDate(selectedDate)
  const inSem = withinSemester(dISO, timetable)

  const dayClasses = useMemo(() => {
    let list = timetable.classes.filter((c) => c.dayOfWeek === selectedDow)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((c) => c.subject.toLowerCase().includes(q) || c.room.toLowerCase().includes(q))
    return list.sort((a, b) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime))
  }, [timetable.classes, selectedDow, search])

  return (
    <div className="m-page m-timetable">
      <header className="m-topbar">
        <h1>Timetable</h1>
        <div className="m-topbar-actions">
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
            placeholder="Search subject or room"
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

      <div className="agenda-list">
        {dayClasses.length === 0 ? (
          <div className="agenda-empty">{search ? 'No matching classes.' : 'No classes today'}</div>
        ) : (
          dayClasses.map((def) => {
            const stored = occurrences[occurrenceId(def.id, dISO)]
            const { display, ended, live, userSet } = occurrenceDisplay(def, selectedDate, stored, now, inSem)
            return (
              <AgendaCard
                key={def.id}
                view={{ def, dateISO: dISO, display, live, ended, userSet }}
                onToggle={toggleAttendance}
                onContext={onContext}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
