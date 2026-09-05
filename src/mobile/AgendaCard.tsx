import { memo, type CSSProperties } from 'react'
import type { ClassDefinition } from '../types'
import type { DisplayStatus } from '../lib/occurrenceDisplay'
import { clockToMinutes, minutesToLabel } from '../lib/time'
import { subjectIcon, subjectStyle } from '../lib/subjectColor'
import { IconCheck, IconX } from '../components/icons'
import { useTapOrLongPress } from '../hooks/useTapOrLongPress'

export interface AgendaView {
  def: ClassDefinition
  dateISO: string
  display: DisplayStatus
  live: boolean
  ended: boolean
  userSet: boolean
}

interface Props {
  view: AgendaView
  onToggle: (defId: string, dateISO: string) => void
  onContext: (defId: string, dateISO: string, x: number, y: number) => void
}

const DOW = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function label(v: AgendaView): string {
  const { def, display } = v
  const time = `${minutesToLabel(clockToMinutes(def.startTime))} to ${minutesToLabel(clockToMinutes(def.endTime))}`
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

export const AgendaCard = memo(function AgendaCard({ view, onToggle, onContext }: Props) {
  const { def, dateISO, display, live } = view
  const press = useTapOrLongPress({
    onTap: () => onToggle(def.id, dateISO),
    onLongPress: (x, y) => onContext(def.id, dateISO, x, y),
  })
  const style = subjectStyle(def.subject || 'Untitled')
  const Icon = subjectIcon(def.subject || '')

  // Only an explicit user action gets a distinct look. A class that simply
  // ended without being touched stays in its ordinary subject color.
  const explicitAbsent = display === 'absent' && view.userSet
  const colored = display === 'unmarked' || (display === 'absent' && !view.userSet)

  const cardStyle = colored ? ({ '--ac-bg': style.bg, '--ac-ink': style.ink } as CSSProperties) : undefined

  return (
    <div className="agenda-row">
      <span className="agenda-time">{minutesToLabel(clockToMinutes(def.startTime), { withMinutes: false })}</span>
      <button
        type="button"
        className={[
          'agenda-card',
          display === 'present' && 'present',
          explicitAbsent && 'absent',
          display === 'cancelled' && 'cancelled',
          live && 'live',
        ]
          .filter(Boolean)
          .join(' ')}
        style={cardStyle}
        aria-label={label(view)}
        aria-pressed={display === 'present'}
        {...press}
      >
        <span className="ac-icon">
          <Icon width={16} height={16} />
        </span>
        <span className="ac-body">
          <span className="ac-subject">{def.subject || 'Untitled'}</span>
          {def.room && <span className="ac-room">{def.room}</span>}
        </span>
        {display === 'present' && (
          <span className="check-circle" aria-hidden="true">
            <IconCheck width={13} height={13} />
          </span>
        )}
        {explicitAbsent && (
          <span className="check-circle absent-mark" aria-hidden="true">
            <IconX width={13} height={13} />
          </span>
        )}
      </button>
    </div>
  )
})
