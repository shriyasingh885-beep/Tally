import { useMemo } from 'react'
import { useApp } from '../store/appStore'
import { computeNextClass } from '../lib/nextClass'
import { clockToMinutes, isoDate, minutesToLabel } from '../lib/time'
import {
  IconBarChart,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconSettings,
} from '../components/icons'
import type { AppPage } from '../types'

interface Props {
  now: Date
  onNavigate: (page: AppPage) => void
  onOpenSettings: (anchor: DOMRect) => void
}

function greeting(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning!'
  if (h < 17) return 'Good afternoon!'
  return 'Good evening!'
}

export function MobileHome({ now, onNavigate, onOpenSettings }: Props) {
  const timetable = useApp((s) => s.timetable)!
  const toggleAttendance = useApp((s) => s.toggleAttendance)
  const info = useMemo(() => computeNextClass(timetable, now), [timetable, now])

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

  const markPresent = () => {
    if (info.kind === 'today' && info.live && info.def) {
      toggleAttendance(info.def.id, isoDate(now))
    } else {
      onNavigate('timetable')
    }
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

      <div className="m-greet">
        <div>
          <h1>{dateLabel}</h1>
          <p>{greeting(now)}</p>
        </div>
        <span className="m-emoji" aria-hidden="true">
          🙂
        </span>
      </div>

      <button className="m-next-card" onClick={() => onNavigate('timetable')}>
        <div className="m-next-top">
          <span className="label">{info.live ? 'Happening now' : 'Next class'}</span>
          {info.kind === 'today' && (
            <span className={`pill-time${info.live ? ' live' : ''}`}>
              {info.live ? 'Now' : `in ${info.minutesUntil} min`}
            </span>
          )}
          {info.kind === 'later' && <span className="pill-time">{info.def ? info.when.split(' · ')[0] : ''}</span>}
        </div>
        {info.kind === 'none' ? (
          <div className="m-next-body">
            <span className="m-next-subject">No more classes today</span>
          </div>
        ) : (
          <div className="m-next-body">
            <span className="dot-live" aria-hidden="true" />
            <div className="m-next-text">
              <span className="m-next-subject">{info.def!.subject || 'Untitled'}</span>
              <span className="m-next-meta">
                {minutesToLabel(clockToMinutes(info.def!.startTime))} –{' '}
                {minutesToLabel(clockToMinutes(info.def!.endTime))}
              </span>
              {info.def!.room && <span className="m-next-meta">{info.def!.room}</span>}
            </div>
            <IconChevronRight width={18} height={18} className="m-next-chev" />
          </div>
        )}
      </button>

      <div className="m-section-label">Quick actions</div>
      <div className="m-quick-actions">
        <button className="m-qa" onClick={markPresent}>
          <span className="m-qa-ico present">
            <IconCheck width={19} height={19} />
          </span>
          Mark Present
        </button>
        <button className="m-qa" onClick={() => onNavigate('timetable')}>
          <span className="m-qa-ico">
            <IconCalendar width={19} height={19} />
          </span>
          View Timetable
        </button>
        <button className="m-qa" onClick={() => onNavigate('attendance')}>
          <span className="m-qa-ico">
            <IconBarChart width={19} height={19} />
          </span>
          Attendance
        </button>
        <button
          className="m-qa"
          onClick={(e) => onOpenSettings((e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          <span className="m-qa-ico">
            <IconSettings width={19} height={19} />
          </span>
          Settings
        </button>
      </div>
    </div>
  )
}
