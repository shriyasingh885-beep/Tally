import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store/appStore'

/**
 * Ask for the semester's dates the first time attendance is opened.
 *
 * Every figure on this page is a fraction of the classes that fall between two
 * dates, and until now those dates were a guess made at setup — this week, plus
 * fifteen. A percentage computed over the wrong window is not slightly wrong,
 * it is meaningless, and worse, it looks authoritative. So ask once, at the
 * moment the numbers first matter, rather than hiding it in a settings menu
 * nobody opens.
 *
 * Asked once and never again, whichever button is used: a prompt that returns
 * every visit is a prompt people learn to dismiss without reading.
 */
export function SemesterPrompt({ onClose }: { onClose: () => void }) {
  const tt = useApp((s) => s.timetable)!
  const setSemester = useApp((s) => s.setSemester)
  const skipSemesterPrompt = useApp((s) => s.skipSemesterPrompt)

  const [start, setStart] = useState(tt.semesterStart)
  const [end, setEnd] = useState(tt.semesterEnd)

  const error = !start || !end ? 'Both dates are needed.' : end < start ? 'The last day is before the first.' : null

  // Through a portal: the desktop shell slides its pages with a transform, and
  // a position:fixed overlay inside a transformed ancestor anchors to that
  // ancestor instead of the window — which put this dialog half off the screen.
  return createPortal(
    <div className="overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Semester dates">
        <h3>When is your semester?</h3>
        <p>
          Attendance is counted only between these dates, so getting them right makes every
          percentage on this page mean something. You can change them later in settings.
        </p>

        <div className="field">
          <label htmlFor="sp-start">First day of the semester</label>
          <input
            id="sp-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sp-end">Last day of the semester</label>
          <input id="sp-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>

        {error && (
          <p className="ec-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button
            className="btn subtle"
            onClick={() => {
              skipSemesterPrompt()
              onClose()
            }}
          >
            Keep the defaults
          </button>
          <button
            className="btn primary"
            disabled={!!error}
            onClick={() => {
              setSemester(start, end)
              onClose()
            }}
          >
            Save dates
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
