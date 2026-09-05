import { useMemo } from 'react'
import { useApp } from '../store/appStore'
import { computeNextClass } from '../lib/nextClass'

interface Props {
  now: Date
}

export function NextClassCard({ now }: Props) {
  const timetable = useApp((s) => s.timetable)!
  const info = useMemo(() => computeNextClass(timetable, now), [timetable, now])

  if (info.kind === 'none') {
    return (
      <div className="next-card empty">
        <span className="label">Next class</span>
        <span className="subject">No more classes today</span>
        <span className="meta">Enjoy the break.</span>
      </div>
    )
  }

  return (
    <div className="next-card">
      <span className="label">{info.kind === 'today' ? 'Next class' : 'No more classes today'}</span>
      <span className="subject">{info.def!.subject || 'Untitled'}</span>
      <span className="meta">
        {info.when}
        {info.def!.room ? ` · ${info.def!.room}` : ''}
      </span>
    </div>
  )
}
