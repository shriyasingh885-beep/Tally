import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { occurrenceId } from '../lib/id'
import { dayBounds, layoutDay, withinSemester } from '../lib/schedule'
import { visibleBreaks } from '../lib/breaks'
import { occurrenceDisplay } from '../lib/occurrenceDisplay'
import { isSameDay, isoDate, isoWeekday, minutesToLabel } from '../lib/time'
import { dowShort, shortDate } from '../lib/format'
import { ClassCell, type CellView } from './ClassCell'

interface Props {
  days: Date[]
  now: Date
  onContext: (defId: string, dateISO: string, x: number, y: number) => void
}

const HEAD_H = 56
const PAD_MIN = 12

export function TimetableGrid({ days, now, onContext }: Props) {
  const timetable = useApp((s) => s.timetable)!
  const occurrences = useApp((s) => s.occurrences)
  const toggleAttendance = useApp((s) => s.toggleAttendance)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [bodyH, setBodyH] = useState(460)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight - HEAD_H))
    ro.observe(el)
    setBodyH(el.clientHeight - HEAD_H)
    return () => ro.disconnect()
  }, [])

  const { min, max } = useMemo(() => {
    const b = dayBounds(timetable.classes)
    return {
      min: Math.floor((b.min - PAD_MIN) / 60) * 60,
      max: Math.ceil((b.max + PAD_MIN) / 60) * 60,
    }
  }, [timetable.classes])

  const span = Math.max(60, max - min)
  const pxPerMin = Math.min(2.2, Math.max(0.85, (bodyH - 8) / span))
  const bodyHeight = span * pxPerMin

  // Lunch is drawn as a band straight across every column, exactly as the
  // printed timetable draws it, with the label in the time gutter so it is said
  // once rather than repeated in all five columns.
  const breakBands = visibleBreaks(timetable.breaks, min, max)

  const hourMarks: number[] = []
  for (let m = min; m <= max; m += 60) hourMarks.push(m)

  const columns = days.map((date) => {
    const dow = isoWeekday(date)
    const dISO = isoDate(date)
    const inSem = withinSemester(dISO, timetable)
    const defs = timetable.classes.filter((c) => c.dayOfWeek === dow)
    const positioned = layoutDay(defs)

    const cells: CellView[] = positioned.map((p) => {
      const stored = occurrences[occurrenceId(p.def.id, dISO)]
      const { display, ended, live, userSet } = occurrenceDisplay(p.def, date, stored, now, inSem)
      return {
        def: p.def,
        dateISO: dISO,
        date,
        top: (p.startMin - min) * pxPerMin,
        height: (p.endMin - p.startMin) * pxPerMin - 4,
        leftPct: (p.lane / p.lanes) * 100,
        widthPct: (1 / p.lanes) * 100,
        display,
        live,
        ended,
        userSet,
      }
    })
    return { date, dow, dISO, cells, isToday: isSameDay(date, now), empty: defs.length === 0 }
  })

  return (
    <div className="grid-wrap" ref={wrapRef}>
      <div className="time-col">
        <div className="cap" />
        <div className="marks" style={{ height: bodyHeight, position: 'relative' }}>
          {hourMarks
            .filter((m) => (m - min) * pxPerMin > 10)
            .map((m) => (
              <span key={m} className="time-mark" style={{ top: (m - min) * pxPerMin }}>
                {minutesToLabel(m, { withMinutes: false })}
              </span>
            ))}
          {breakBands.map((b) => (
            <span
              key={b.brk.id}
              className="break-label"
              style={{
                top: (b.startMin - min) * pxPerMin,
                height: (b.endMin - b.startMin) * pxPerMin,
              }}
            >
              {b.brk.label}
            </span>
          ))}
        </div>
      </div>

      <div className="days">
        {columns.map((col) => (
          <div key={col.dISO} className={`day-col${col.isToday ? ' today' : ''}`}>
            <div className="day-head">
              <span className="dow">{dowShort(col.date)}</span>
              <span className="date">{shortDate(col.date)}</span>
            </div>
            <div className="day-body" style={{ height: bodyHeight }}>
              {hourMarks.map((m) => (
                <span key={m} className="hour-line" style={{ top: (m - min) * pxPerMin }} />
              ))}
              {breakBands.map((b) => (
                <span
                  key={b.brk.id}
                  className="break-band"
                  aria-hidden="true"
                  style={{
                    top: (b.startMin - min) * pxPerMin,
                    height: (b.endMin - b.startMin) * pxPerMin,
                  }}
                />
              ))}
              {col.empty ? (
                <span className="day-empty">No class</span>
              ) : (
                col.cells.map((v) => (
                  <ClassCell
                    key={v.def.id}
                    view={v}
                    onToggle={toggleAttendance}
                    onContext={onContext}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
