import { useApp } from '../store/appStore'
import { IconCheck } from '../components/icons'

export function SetupComplete() {
  const openTimetable = useApp((s) => s.openTimetable)
  return (
    <div className="setup-card">
      <div className="done-wrap">
        <div className="done-mark">
          <IconCheck width={30} height={30} />
        </div>
        <h1 className="setup-h">All set!</h1>
        <p className="setup-p">Your timetable is ready. Let’s make the most of it.</p>
        <div style={{ marginTop: 26, display: 'flex', justifyContent: 'center' }}>
          <button className="btn primary" onClick={openTimetable} autoFocus>
            Open Timetable →
          </button>
        </div>
      </div>
    </div>
  )
}
