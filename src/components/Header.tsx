import { useRef } from 'react'
import type { AppPage } from '../types'
import { IconMoon, IconSettings, IconSun } from './icons'

interface Props {
  page: AppPage
  onPage: (p: AppPage) => void
  onToday: () => void
  onOpenSettings: (anchor: DOMRect) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export function Header({ page, onPage, onToday, onOpenSettings, theme, onToggleTheme }: Props) {
  const gearRef = useRef<HTMLButtonElement>(null)
  return (
    <header className="header">
      <div className="brand">
        Tally<span className="dot">.</span>
      </div>

      <div className="segmented" role="tablist" aria-label="View">
        <span
          className="thumb"
          style={{ width: 'calc(50% - 3px)', transform: `translateX(${page === 'attendance' ? '100%' : '0'})` }}
        />
        <button
          role="tab"
          aria-selected={page === 'timetable'}
          onClick={() => onPage('timetable')}
        >
          Timetable
        </button>
        <button
          role="tab"
          aria-selected={page === 'attendance'}
          onClick={() => onPage('attendance')}
        >
          Attendance
        </button>
      </div>

      <div className="header-right">
        {page === 'timetable' && (
          <button className="ghost-btn" onClick={onToday}>
            Today
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <IconMoon width={17} height={17} /> : <IconSun width={17} height={17} />}
        </button>
        <button
          ref={gearRef}
          className="icon-btn"
          aria-label="Settings"
          onClick={() => gearRef.current && onOpenSettings(gearRef.current.getBoundingClientRect())}
        >
          <IconSettings width={17} height={17} />
        </button>
        <span className="avatar" aria-hidden="true">
          V
        </span>
      </div>
    </header>
  )
}
