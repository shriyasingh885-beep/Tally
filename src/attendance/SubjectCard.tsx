import { memo } from 'react'
import type { SubjectStat } from '../lib/stats'
import { subjectIcon, subjectStyle } from '../lib/subjectColor'
import { IconChevronRight } from '../components/icons'

export const SubjectCard = memo(function SubjectCard({ s }: { s: SubjectStat }) {
  const pctLabel = s.percentage == null ? '—' : `${Math.round(s.percentage)}%`
  const barWidth = s.percentage == null ? 0 : Math.max(0, Math.min(100, s.percentage))
  const tone = s.health === 'danger' ? 'danger' : s.health === 'warning' ? 'warning' : ''
  const style = subjectStyle(s.subject)
  const Icon = subjectIcon(s.subject)
  const countLabel = s.completed === 0 ? `${s.remaining} scheduled` : `${s.present} / ${s.completed} classes`

  return (
    <div className="subj">
      <span className="subj-icon" style={{ background: style.bg, color: style.ink }}>
        <Icon width={16} height={16} />
      </span>
      <div className="subj-main">
        <div className="subj-row1">
          <span className="subj-name">{s.subject}</span>
          <span className={`subj-pct ${tone}`}>{pctLabel}</span>
        </div>
        <div className="bar" aria-hidden="true">
          <i className={tone} style={{ width: `${barWidth}%` }} />
        </div>
        <div className="subj-row3">
          <span className="subj-meta">{countLabel}</span>
          <span className={`subj-msg ${tone}`}>{s.message}</span>
        </div>
      </div>
      <IconChevronRight width={17} height={17} className="subj-chev" aria-hidden="true" />
    </div>
  )
})
