import { IconPhone } from './icons'

export function RotateOverlay({ onViewAttendance }: { onViewAttendance: () => void }) {
  return (
    <div className="rotate" role="dialog" aria-label="Rotate your device">
      <div className="inner">
        <div className="phone">
          <IconPhone />
        </div>
        <h2>Rotate your device</h2>
        <p>This timetable is designed for landscape view. Turn your phone sideways.</p>
        <button className="btn subtle" onClick={onViewAttendance}>
          View attendance instead
        </button>
      </div>
    </div>
  )
}
