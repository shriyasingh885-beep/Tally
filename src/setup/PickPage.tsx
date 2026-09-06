import { useState } from 'react'
import { useApp } from '../store/appStore'
import { IconChevronRight } from '../components/icons'

interface Props {
  onPick: (pageNumber: number) => void
}

/**
 * Which of these timetables is yours?
 *
 * An institute publishes one PDF holding a page per branch. Reading only the
 * first hands eleven students out of twelve somebody else's schedule, and
 * parsing all twelve would take minutes to throw away everything but one. So
 * ask — the page headings are already in the file, and reading them costs
 * nothing next to extraction.
 */
export function PickPage({ onPick }: Props) {
  const pages = useApp((s) => s.pdfPages)
  const restartSetup = useApp((s) => s.restartSetup)
  const [chosen, setChosen] = useState<number | null>(null)

  return (
    <div className="setup-card">
      {/* Not numbered: this step only exists for a file that holds several
          timetables, and renumbering the rest for everyone else would be worse
          than leaving one screen without a count. */}
      <div className="setup-kicker">Setup · Choose a page</div>
      <h1 className="setup-h">Which timetable is yours?</h1>
      <p className="setup-p">
        This file holds {pages.length} timetables. Pick the one for your branch — we&rsquo;ll read just
        that page.
      </p>

      <ul className="page-list">
        {pages.map((p) => (
          <li key={p.number}>
            <button
              className={`page-item${chosen === p.number ? ' chosen' : ''}`}
              onClick={() => setChosen(p.number)}
              aria-pressed={chosen === p.number}
            >
              <span className="page-num">{p.number}</span>
              <span className="page-label">{p.label || <em>Page {p.number}</em>}</span>
              <IconChevronRight width={16} height={16} className="page-chev" />
            </button>
          </li>
        ))}
      </ul>

      <div className="setup-actions spread">
        <button className="btn subtle" onClick={restartSetup}>
          Choose another file
        </button>
        <button className="btn primary" disabled={chosen == null} onClick={() => onPick(chosen!)}>
          Read this one →
        </button>
      </div>
    </div>
  )
}
