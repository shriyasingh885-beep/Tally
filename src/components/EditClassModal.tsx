import { useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import type { ClassType } from '../types'

const DAYS = [
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
  { v: 7, label: 'Sun' },
]

const TYPES: Array<{ v: ClassType; label: string }> = [
  { v: 'lecture', label: 'Lecture' },
  { v: 'lab', label: 'Lab' },
  { v: 'tutorial', label: 'Tutorial' },
  { v: 'other', label: 'Other' },
]

/**
 * Fix one class without leaving the timetable.
 *
 * Settings already has a whole-table editor, but the mistake you actually want
 * to fix is nearly always the cell you are looking at — a subject OCR misread,
 * a room that moved. Reaching it from the cell itself turns a five-step detour
 * into one tap, and the class keeps its id so attendance already marked against
 * it is untouched.
 */
export function EditClassModal({ defId, onClose }: { defId: string; onClose: () => void }) {
  const def = useApp((s) => s.timetable?.classes.find((c) => c.id === defId))
  const updateClass = useApp((s) => s.updateClass)

  const [subject, setSubject] = useState(def?.subject ?? '')
  const [batch, setBatch] = useState(def?.batch ?? '')
  const [teacher, setTeacher] = useState(def?.teacher ?? '')
  const [room, setRoom] = useState(def?.room ?? '')
  const [dayOfWeek, setDayOfWeek] = useState(def?.dayOfWeek ?? 1)
  const [startTime, setStartTime] = useState(def?.startTime ?? '09:00')
  const [endTime, setEndTime] = useState(def?.endTime ?? '10:00')
  const [type, setType] = useState<ClassType>(def?.type ?? 'lecture')

  const error = useMemo(() => {
    if (!subject.trim()) return 'Give the class a subject.'
    if (!startTime || !endTime) return 'Both a start and an end time are needed.'
    if (endTime <= startTime) return 'The end time has to be after the start time.'
    return null
  }, [subject, startTime, endTime])

  // The class was deleted from under us (another tab, a reset) — nothing to edit.
  if (!def) return null

  const save = () => {
    if (error) return
    updateClass(defId, { subject, batch, teacher, room, dayOfWeek, startTime, endTime, type })
    onClose()
  }

  return (
    <div className="overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit class">
        <h3>Edit class</h3>
        <p>Changes apply to this class every week. Attendance you’ve already marked is kept.</p>

        <div className="field">
          <label htmlFor="ec-subject">Subject</label>
          <input
            id="ec-subject"
            autoFocus
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Mathematics III"
          />
        </div>

        <div className="ec-grid">
          <div className="field">
            <label htmlFor="ec-batch">Batch</label>
            <input
              id="ec-batch"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="B1"
            />
          </div>
          <div className="field">
            <label htmlFor="ec-room">Room</label>
            <input
              id="ec-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="ATC-309"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="ec-teacher">Faculty</label>
          <input
            id="ec-teacher"
            value={teacher}
            onChange={(e) => setTeacher(e.target.value)}
            placeholder="ShV"
          />
        </div>

        <div className="ec-grid">
          <div className="field">
            <label htmlFor="ec-day">Day</label>
            <select id="ec-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
              {DAYS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ec-type">Type</label>
            <select id="ec-type" value={type} onChange={(e) => setType(e.target.value as ClassType)}>
              {TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ec-grid">
          <div className="field">
            <label htmlFor="ec-start">Starts</label>
            <input
              id="ec-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ec-end">Ends</label>
            <input id="ec-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        {error && (
          <p className="ec-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!!error}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
