import { useMemo } from 'react'
import { useApp } from '../store/appStore'
import { ClassTable } from '../components/ClassTable'

export function TimetableReview() {
  const draftClasses = useApp((s) => s.draftClasses)
  const reviewNote = useApp((s) => s.reviewNote)
  const updateDraftClass = useApp((s) => s.updateDraftClass)
  const addDraftClass = useApp((s) => s.addDraftClass)
  const renameDraftSubject = useApp((s) => s.renameDraftSubject)
  const removeDraftClass = useApp((s) => s.removeDraftClass)
  const confirmTimetable = useApp((s) => s.confirmTimetable)
  const restartSetup = useApp((s) => s.restartSetup)

  const flagged = useMemo(
    () => draftClasses.filter((c) => c.review && c.review.length).length,
    [draftClasses],
  )
  const valid = draftClasses.some((c) => c.subject.trim())

  return (
    <div className="setup-card review-card">
      <div className="setup-kicker">Setup · Step 3 of 3</div>
      {draftClasses.length ? (
        <>
          <div className="review-count">
            We found {draftClasses.length} {draftClasses.length === 1 ? 'class' : 'classes'}
          </div>
          <p className="setup-p">
            {reviewNote ??
              `Please review your timetable.${
                flagged > 0 ? ` ${flagged} ${flagged === 1 ? 'entry needs' : 'entries need'} a quick check (amber).` : ''
              }`}
          </p>
        </>
      ) : (
        <>
          <div className="review-count">Build your timetable</div>
          <p className="setup-p">
            {reviewNote ??
              'We couldn’t find a recognizable timetable. Add your classes below — it only takes a minute.'}
          </p>
        </>
      )}

      {draftClasses.length === 0 && (
        <div className="review-empty">No classes yet. Use “Add class” to start.</div>
      )}

      <ClassTable
        classes={draftClasses}
        onChange={updateDraftClass}
        onAdd={() => addDraftClass()}
        onRemove={removeDraftClass}
        onRenameSubject={renameDraftSubject}
      />

      <div className="setup-actions">
        <button className="btn subtle" onClick={restartSetup}>
          Upload another file
        </button>
        <button className="btn primary" disabled={!valid} onClick={confirmTimetable}>
          Looks good →
        </button>
      </div>
    </div>
  )
}
