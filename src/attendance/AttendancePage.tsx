import { useMemo } from 'react'
import { useApp } from '../store/appStore'
import { computeStats } from '../lib/stats'
import { IconBarChart, IconChevronDown } from '../components/icons'
import { OverallAttendance } from './OverallAttendance'
import { SubjectCard } from './SubjectCard'

interface Props {
  now: Date
  onOpenSettings?: (anchor: DOMRect) => void
}

function statusCopy(health: 'ok' | 'warning' | 'danger' | 'none'): string {
  if (health === 'none') return 'Mark a class present to start tracking.'
  if (health === 'ok') return "Keep showing up. You've got this."
  if (health === 'warning') return 'A couple more classes locks this in.'
  return "It's catching up, not over — attend the next few."
}

export function AttendancePage({ now, onOpenSettings }: Props) {
  const timetable = useApp((s) => s.timetable)!
  const occurrences = useApp((s) => s.occurrences)
  const nonClassDates = useApp((s) => s.nonClassDates)

  const { overall, subjects } = useMemo(
    () => computeStats(timetable, occurrences, nonClassDates, now),
    [timetable, occurrences, nonClassDates, now],
  )

  return (
    <div className="at-page">
      <div className="at-head">
        <div>
          <h1 className="at-title">Attendance</h1>
          <p className="at-sub">Target {timetable.attendanceTarget}%</p>
        </div>
        <button
          className="semester-chip"
          onClick={(e) => onOpenSettings?.((e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          This Semester
          <IconChevronDown width={14} height={14} />
        </button>
      </div>

      <OverallAttendance stat={overall} />

      <div className="subjects-h">Subjects</div>
      {subjects.length === 0 ? (
        <div className="review-empty">No subjects yet.</div>
      ) : (
        <div className="subj-list">
          {subjects.map((s) => (
            <SubjectCard key={s.subject} s={s} />
          ))}
        </div>
      )}

      <div className={`status-card ${overall.health}`}>
        <span className="status-ico">
          <IconBarChart width={18} height={18} />
        </span>
        <div className="status-text">
          <span className="status-title">{overall.message}</span>
          <span className="status-sub">{statusCopy(overall.health)}</span>
        </div>
      </div>
    </div>
  )
}
