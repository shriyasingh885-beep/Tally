import { useMemo } from 'react'
import { useApp } from '../store/appStore'
import { getWeekDays } from '../lib/schedule'
import { IconChevronLeft, IconChevronRight } from '../components/icons'
import { TimetableGrid } from './TimetableGrid'
import { NextClassCard } from './NextClassCard'
import { Legend } from './Legend'

interface Props {
  now: Date
  onContext: (defId: string, dateISO: string, x: number, y: number) => void
}

export function TimetablePage({ now, onContext }: Props) {
  const weekOffset = useApp((s) => s.weekOffset)
  const nextWeek = useApp((s) => s.nextWeek)
  const prevWeek = useApp((s) => s.prevWeek)

  const days = useMemo(() => getWeekDays(weekOffset, 1, 5, now), [weekOffset, now])
  const todayLabel = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="tt-page">
      <div className="tt-top">
        <div className="tt-heading">
          <button className="round-btn" aria-label="Previous week" onClick={prevWeek}>
            <IconChevronLeft width={16} height={16} />
          </button>
          <div className="tt-heading-text">
            <h1 className="tt-title">{todayLabel}</h1>
            <p className="tt-subtitle">Make it count.</p>
          </div>
          <button className="round-btn" aria-label="Next week" onClick={nextWeek}>
            <IconChevronRight width={16} height={16} />
          </button>
        </div>
        <NextClassCard now={now} />
      </div>

      <TimetableGrid days={days} now={now} onContext={onContext} />
      <Legend />
    </div>
  )
}
