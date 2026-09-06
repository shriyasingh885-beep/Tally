import { describe, expect, it } from 'vitest'
import { breakLabel, dedupeBreaks, isBreakLabel, visibleBreaks, withBreaks } from './breaks'
import type { BreakPeriod } from '../types'

const brk = (id: string, startTime: string, endTime: string, label = 'Lunch break'): BreakPeriod => ({
  id,
  label,
  startTime,
  endTime,
})

describe('spotting a break', () => {
  it('recognises how timetables print one', () => {
    for (const s of ['LUNCH BREAK', 'Lunch Break', 'BREAK', 'lunch', 'Recess', 'TEA BREAK', 'Interval']) {
      expect(isBreakLabel(s), s).toBe(true)
    }
  })

  it('does not swallow a real class that merely contains the word', () => {
    for (const s of ['Breaking Systems', 'Circuit Breakers', 'Break Even Analysis', 'Applied Physics']) {
      expect(isBreakLabel(s), s).toBe(false)
    }
  })

  it('ignores punctuation the document decorated it with', () => {
    expect(isBreakLabel('-- LUNCH BREAK --')).toBe(true)
    expect(isBreakLabel('')).toBe(false)
  })

  it('tidies the label without inventing one', () => {
    expect(breakLabel('LUNCH BREAK')).toBe('Lunch break')
    expect(breakLabel('recess')).toBe('Recess')
  })
})

describe('one lunch, not five', () => {
  it('collapses the same break read once per day column', () => {
    const out = dedupeBreaks([
      brk('a', '12:45', '14:00'),
      brk('b', '12:45', '14:00'),
      brk('c', '12:45', '14:00'),
    ])
    expect(out).toHaveLength(1)
  })

  it('keeps two genuinely different breaks, earliest first', () => {
    const out = dedupeBreaks([brk('b', '12:45', '14:00'), brk('a', '10:30', '10:45', 'Break')])
    expect(out.map((b) => b.startTime)).toEqual(['10:30', '12:45'])
  })
})

describe('placing a break in a day', () => {
  const items = [
    { startMin: 9 * 60, endMin: 10 * 60 },
    { startMin: 11 * 60, endMin: 12 * 60 },
    { startMin: 14 * 60, endMin: 15 * 60 },
  ]

  it('drops it into the running order', () => {
    const rows = withBreaks(items, [brk('l', '12:45', '14:00')])
    expect(rows.map((r) => r.kind)).toEqual(['item', 'item', 'break', 'item'])
  })

  it('leaves it out of a day that never reaches it', () => {
    const morning = [{ startMin: 9 * 60, endMin: 10 * 60 }]
    expect(withBreaks(morning, [brk('l', '12:45', '14:00')])).toHaveLength(1)
  })

  it('says nothing on a day with no classes at all', () => {
    expect(withBreaks([], [brk('l', '12:45', '14:00')])).toHaveLength(0)
  })

  it('is unchanged when the timetable has no breaks', () => {
    expect(withBreaks(items, undefined)).toHaveLength(3)
    expect(withBreaks(items, [])).toHaveLength(3)
  })
})

describe('break bands on a grid', () => {
  it('clips a band to the span being drawn', () => {
    const [band] = visibleBreaks([brk('l', '12:45', '14:00')], 13 * 60, 18 * 60)
    expect(band.startMin).toBe(13 * 60)
    expect(band.endMin).toBe(14 * 60)
  })

  it('omits a break outside the drawn span', () => {
    expect(visibleBreaks([brk('l', '12:45', '14:00')], 15 * 60, 18 * 60)).toHaveLength(0)
  })
})
