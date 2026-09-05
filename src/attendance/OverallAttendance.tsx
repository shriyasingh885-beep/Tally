import type { OverallStat } from '../lib/stats'
import { IconChevronRight } from '../components/icons'

const R = 30
const C = 2 * Math.PI * R

export function OverallAttendance({ stat }: { stat: OverallStat }) {
  const pct = stat.percentage
  const dash = pct == null ? 0 : (Math.max(0, Math.min(100, pct)) / 100) * C
  const stroke =
    stat.health === 'danger'
      ? 'var(--danger-ink)'
      : stat.health === 'warning'
        ? 'var(--warn-ink)'
        : 'var(--accent)'

  return (
    <div className="overall">
      <div className="ring">
        <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r={R} fill="none" stroke="var(--bg-sunk)" strokeWidth="7" />
          {pct != null && (
            <circle
              cx="38"
              cy="38"
              r={R}
              fill="none"
              stroke={stroke}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`}
              transform="rotate(-90 38 38)"
              style={{ transition: 'stroke-dasharray var(--dur-page) var(--ease)' }}
            />
          )}
        </svg>
      </div>
      <div className="big">
        <span className="label">Overall attendance</span>
        <span className="pct">{pct == null ? '—' : `${Math.round(pct)}%`}</span>
        <span className="counts">
          {pct == null
            ? 'No attendance recorded yet'
            : `${stat.present} attended · ${stat.absent} missed · ${stat.completed} total`}
        </span>
        <span className={`pill ${stat.health}`}>{stat.message}</span>
      </div>
      <IconChevronRight width={18} height={18} className="overall-chev" aria-hidden="true" />
    </div>
  )
}
