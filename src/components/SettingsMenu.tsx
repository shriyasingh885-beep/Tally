import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../store/appStore'
import type { ClassDefinition } from '../types'
import { ClassTable } from './ClassTable'
import { uid } from '../lib/id'

type Modal = null | 'edit' | 'target' | 'semester' | 'reset'

export function SettingsMenu({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const [modal, setModal] = useState<Modal>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (modal) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose, modal])

  const left = Math.max(8, anchor.right - 210)
  const top = anchor.bottom + 8

  return (
    <>
      {!modal && (
        <div className="menu" ref={menuRef} style={{ left, top }} role="menu">
          <button role="menuitem" onClick={() => setModal('edit')}>
            Edit timetable
          </button>
          <button role="menuitem" onClick={() => setModal('target')}>
            Attendance target
          </button>
          <button role="menuitem" onClick={() => setModal('semester')}>
            Semester dates
          </button>
          <div className="sep" />
          <button role="menuitem" className="danger" onClick={() => setModal('reset')}>
            Reset timetable
          </button>
        </div>
      )}
      {modal === 'edit' && <EditTimetableModal onClose={onClose} />}
      {modal === 'target' && <TargetModal onClose={onClose} />}
      {modal === 'semester' && <SemesterModal onClose={onClose} />}
      {modal === 'reset' && <ResetModal onClose={onClose} />}
    </>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

function EditTimetableModal({ onClose }: { onClose: () => void }) {
  const timetable = useApp((s) => s.timetable)!
  const replaceClasses = useApp((s) => s.replaceClasses)
  const [rows, setRows] = useState<ClassDefinition[]>(() => timetable.classes.map((c) => ({ ...c })))

  return (
    <Shell>
      <h3>Edit timetable</h3>
      <p>Adjust subjects, times and rooms. Attendance you’ve already marked is kept.</p>
      <div style={{ maxHeight: '60vh', overflowY: 'auto', margin: '0 -6px', padding: '0 6px' }}>
        <ClassTable
          classes={rows}
          onChange={(id, patch) => setRows((r) => r.map((c) => (c.id === id ? { ...c, ...patch } : c)))}
          onAdd={() =>
            setRows((r) => [
              ...r,
              {
                id: uid('cls'),
                subject: '',
                room: '',
                type: 'lecture',
                dayOfWeek: 1,
                startTime: '09:00',
                endTime: '10:00',
              },
            ])
          }
          onRemove={(id) => setRows((r) => r.filter((c) => c.id !== id))}
        />
      </div>
      <div className="modal-actions">
        <button className="btn subtle" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            replaceClasses(
              rows
                .map((c) => ({ ...c, subject: c.subject.trim(), room: c.room.trim() }))
                .filter((c) => c.subject),
            )
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Shell>
  )
}

function TargetModal({ onClose }: { onClose: () => void }) {
  const target = useApp((s) => s.timetable!.attendanceTarget)
  const setAttendanceTarget = useApp((s) => s.setAttendanceTarget)
  const [v, setV] = useState(String(target))
  return (
    <Shell>
      <h3>Attendance target</h3>
      <p>The minimum percentage used for projections across every subject.</p>
      <div className="field">
        <label htmlFor="tgt">Target percentage</label>
        <input
          id="tgt"
          type="number"
          min={1}
          max={100}
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      </div>
      <div className="modal-actions">
        <button className="btn subtle" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            const n = Number(v)
            if (Number.isFinite(n)) setAttendanceTarget(n)
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Shell>
  )
}

function SemesterModal({ onClose }: { onClose: () => void }) {
  const tt = useApp((s) => s.timetable)!
  const setSemester = useApp((s) => s.setSemester)
  const [start, setStart] = useState(tt.semesterStart)
  const [end, setEnd] = useState(tt.semesterEnd)
  const invalid = !start || !end || end < start
  return (
    <Shell>
      <h3>Semester dates</h3>
      <p>Classes are only counted between these dates.</p>
      <div className="field">
        <label htmlFor="s1">First day</label>
        <input id="s1" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="s2">Last day</label>
        <input id="s2" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="modal-actions">
        <button className="btn subtle" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={invalid}
          onClick={() => {
            setSemester(start, end)
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Shell>
  )
}

function ResetModal({ onClose }: { onClose: () => void }) {
  const resetTimetable = useApp((s) => s.resetTimetable)
  return (
    <Shell>
      <h3>Reset timetable?</h3>
      <p>
        This permanently deletes your timetable and every attendance record on this device. This
        cannot be undone.
      </p>
      <div className="modal-actions">
        <button className="btn subtle" onClick={onClose}>
          Keep it
        </button>
        <button
          className="btn"
          style={{ borderColor: 'var(--danger-border)', color: 'var(--danger-ink)', background: 'var(--danger-bg)' }}
          onClick={() => {
            void resetTimetable()
            onClose()
          }}
        >
          Reset everything
        </button>
      </div>
    </Shell>
  )
}
