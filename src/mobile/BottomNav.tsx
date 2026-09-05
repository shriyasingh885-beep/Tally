import type { AppPage } from '../types'
import { IconBarChart, IconCalendar, IconHome } from '../components/icons'

const ITEMS: Array<{ key: AppPage; label: string; Icon: typeof IconHome }> = [
  { key: 'home', label: 'Home', Icon: IconHome },
  { key: 'timetable', label: 'Timetable', Icon: IconCalendar },
  { key: 'attendance', label: 'Attendance', Icon: IconBarChart },
]

export function BottomNav({ page, onChange }: { page: AppPage; onChange: (p: AppPage) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={`bn-item${page === key ? ' active' : ''}`}
          aria-current={page === key ? 'page' : undefined}
          onClick={() => onChange(key)}
        >
          <Icon width={21} height={21} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
