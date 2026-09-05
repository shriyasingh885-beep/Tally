import { useApp } from '../store/appStore'
import { IconCheck } from '../components/icons'

export function ParsingState() {
  const steps = useApp((s) => s.parseSteps)
  const progress = useApp((s) => s.parseProgress)
  return (
    <div className="setup-card">
      <div className="setup-kicker">Setup · Step 2 of 3</div>
      <h1 className="setup-h">Reading your timetable…</h1>
      <p className="setup-p">This stays on your device. It usually takes a few seconds.</p>
      <div className="checklist">
        {steps.map((s) => (
          <div key={s.key} className={`check-row ${s.state}`}>
            <span className="mk">
              {s.state === 'done' ? (
                <IconCheck width={13} height={13} />
              ) : s.state === 'active' ? (
                <span className="spinner" />
              ) : null}
            </span>
            {s.label}
            {s.state === 'active' && progress != null && progress > 0 && (
              <span className="check-pct">{Math.min(99, Math.round(progress))}%</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
