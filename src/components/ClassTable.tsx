import { memo, useRef } from 'react'
import type { ClassDefinition } from '../types'
import { IconX } from './icons'

const DAYS = [
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
  { v: 7, label: 'Sun' },
]

interface Props {
  classes: ClassDefinition[]
  onChange: (id: string, patch: Partial<ClassDefinition>) => void
  onAdd: () => void
  onRemove: (id: string) => void
  /** when set, committing a subject edit renames every class that shared it */
  onRenameSubject?: (from: string, to: string) => void
}

function needs(c: ClassDefinition, field: string): boolean {
  return !!c.review?.includes(field)
}

export const ClassTable = memo(function ClassTable({
  classes,
  onChange,
  onAdd,
  onRemove,
  onRenameSubject,
}: Props) {
  const editingFrom = useRef<string>('')
  const sorted = [...classes].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
  )
  const duplicates = new Map<string, number>()
  for (const c of classes) {
    const k = c.subject.trim()
    if (k) duplicates.set(k, (duplicates.get(k) ?? 0) + 1)
  }
  return (
    <div>
      <div className="review-table" role="table" aria-label="Detected classes">
        <div className="rt-head" role="row">
          <span>Subject</span>
          <span>Day</span>
          <span>Start</span>
          <span>End</span>
          <span>Room</span>
          <span aria-hidden="true" />
        </div>
        {sorted.map((c) => (
          <div className="rt-row" role="row" key={c.id}>
            <input
              aria-label="Subject"
              className={needs(c, 'subject') ? 'flag' : undefined}
              value={c.subject}
              placeholder="Subject name"
              title={
                onRenameSubject && (duplicates.get(c.subject.trim()) ?? 0) > 1
                  ? `Renaming this updates all ${duplicates.get(c.subject.trim())} classes called “${c.subject.trim()}”`
                  : undefined
              }
              onFocus={() => {
                editingFrom.current = c.subject.trim()
              }}
              onChange={(e) => onChange(c.id, { subject: e.target.value })}
              onBlur={(e) => onRenameSubject?.(editingFrom.current, e.target.value)}
            />
            <select
              aria-label="Day"
              className={needs(c, 'dayOfWeek') ? 'flag' : undefined}
              value={c.dayOfWeek}
              onChange={(e) => onChange(c.id, { dayOfWeek: Number(e.target.value) })}
            >
              {DAYS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Start time"
              type="time"
              className={needs(c, 'startTime') ? 'flag' : undefined}
              value={c.startTime}
              onChange={(e) => onChange(c.id, { startTime: e.target.value })}
            />
            <input
              aria-label="End time"
              type="time"
              className={needs(c, 'endTime') ? 'flag' : undefined}
              value={c.endTime}
              onChange={(e) => onChange(c.id, { endTime: e.target.value })}
            />
            <input
              aria-label="Room"
              className={needs(c, 'room') ? 'flag' : undefined}
              value={c.room}
              placeholder="—"
              onChange={(e) => onChange(c.id, { room: e.target.value })}
            />
            <button
              className="rt-del"
              aria-label={`Remove ${c.subject || 'class'}`}
              onClick={() => onRemove(c.id)}
            >
              <IconX width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn subtle" onClick={onAdd}>
          + Add class
        </button>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-3)' }}>
          Amber fields need a quick check.
          {onRenameSubject && ' Renaming a subject updates every class with that name.'}
        </span>
      </div>
    </div>
  )
})
