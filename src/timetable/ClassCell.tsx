import { memo, useRef, type CSSProperties } from 'react'
import type { ClassDefinition } from '../types'
import { IconCheck, IconX } from '../components/icons'
import { minutesToLabel, clockToMinutes } from '../lib/time'
import { subjectStyle } from '../lib/subjectColor'

export interface CellView {
  def: ClassDefinition
  dateISO: string
  date: Date
  top: number
  height: number
  leftPct: number
  widthPct: number
  /** what to render */
  display: 'unmarked' | 'present' | 'absent' | 'cancelled'
  live: boolean
  /** logical: has this occurrence's end time passed */
  ended: boolean
  /** the status came from an explicit user action (not derived from the clock) */
  userSet: boolean
}

interface Props {
  view: CellView
  onToggle: (defId: string, dateISO: string) => void
  onContext: (defId: string, dateISO: string, x: number, y: number) => void
}

const DOW = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function label(v: CellView): string {
  const { def, display } = v
  const time = `${minutesToLabel(clockToMinutes(def.startTime))} to ${minutesToLabel(
    clockToMinutes(def.endTime),
  )}`
  const room = def.room ? `, room ${def.room}` : ''
  const state =
    display === 'present'
      ? 'present'
      : display === 'cancelled'
        ? 'cancelled'
        : display === 'absent'
          ? v.userSet
            ? 'marked absent'
            : 'not marked, counts as absent'
          : 'attendance not marked'
  return `${def.subject || 'Untitled class'}, ${DOW[def.dayOfWeek]}, ${time}${room}, ${state}`
}

export const ClassCell = memo(function ClassCell({ view, onToggle, onContext }: Props) {
  const { def, dateISO, display, live, height } = view
  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  const longPress = useRef<number | undefined>(undefined)
  const moved = useRef(false)

  const clearLong = () => {
    if (longPress.current) {
      window.clearTimeout(longPress.current)
      longPress.current = undefined
    }
  }

  const commitToggle = () => {
    if (window.getSelection()?.toString()) return
    onToggle(def.id, dateISO)
  }

  // A class only gets a special look when the user actually did something to
  // it (marked present, marked absent, cancelled it). Everything else —
  // including a class that simply ended without being touched — stays in its
  // ordinary subject color; "counts as absent" is a stats fact, not a look.
  const explicitAbsent = display === 'absent' && view.userSet
  const colored = display === 'unmarked' || (display === 'absent' && !view.userSet)

  const subj = subjectStyle(def.subject || 'Untitled')
  const cellStyle: CSSProperties & Record<string, string | number> = {
    top: view.top,
    height: Math.max(30, height),
    left: `calc(${view.leftPct}% + 4px)`,
    width: `calc(${view.widthPct}% - 8px)`,
  }
  if (colored) {
    cellStyle.background = subj.bg
    cellStyle.borderColor = 'transparent'
    cellStyle['--cell-ink'] = subj.ink
  }

  return (
    <button
      type="button"
      className={[
        'cell',
        display === 'present' && 'present',
        explicitAbsent && 'absent',
        display === 'cancelled' && 'cancelled',
        live && 'live',
      ]
        .filter(Boolean)
        .join(' ')}
      style={cellStyle}
      aria-label={label(view)}
      aria-pressed={display === 'present'}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY, t: Date.now() }
        moved.current = false
        if (e.pointerType === 'touch') {
          clearLong()
          longPress.current = window.setTimeout(() => {
            onContext(def.id, dateISO, e.clientX, e.clientY)
            down.current = null
          }, 480)
        }
      }}
      onPointerMove={(e) => {
        if (!down.current) return
        if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 8) {
          moved.current = true
          clearLong()
        }
      }}
      onPointerUp={() => clearLong()}
      onPointerCancel={() => {
        clearLong()
        down.current = null
      }}
      onClick={() => {
        clearLong()
        if (moved.current || !down.current) {
          down.current = null
          return
        }
        down.current = null
        commitToggle()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(def.id, dateISO)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext(def.id, dateISO, e.clientX, e.clientY)
      }}
    >
      <span className="c-subject">
        {live && <span className="dot-live" aria-hidden="true" />}
        <span>{def.subject || 'Untitled'}</span>
        {display === 'present' && (
          <span className="check" aria-hidden="true">
            <IconCheck width={10} height={10} />
          </span>
        )}
        {explicitAbsent && (
          <span className="check absent-mark" aria-hidden="true">
            <IconX width={10} height={10} />
          </span>
        )}
      </span>
      {def.room && <span className="c-room">{def.room}</span>}
      {height > 88 && (
        <span className="c-time">
          {minutesToLabel(clockToMinutes(def.startTime))} – {minutesToLabel(clockToMinutes(def.endTime))}
        </span>
      )}
    </button>
  )
})
