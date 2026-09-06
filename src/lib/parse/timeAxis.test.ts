import { describe, expect, it } from 'vitest'
import { buildTimeAxis } from './timeAxis'
import { parseTimeRanges } from '../time'

const at = (h: number, m = 0) => h * 60 + m
const spans = (axis: ReturnType<typeof buildTimeAxis>) =>
  axis.slots.map((s) => (s ? [s.start, s.end] : null))

describe('reading more than one label out of a cell', () => {
  it('finds both ranges a collapsed row squashed together', () => {
    expect(parseTimeRanges('10:00-11:00 11:00-12:00')).toEqual([
      { start: at(10), end: at(11) },
      { start: at(11), end: at(12) },
    ])
  })

  it('survives the usual OCR mangling of the separator', () => {
    expect(parseTimeRanges('08:00-09-00 09:00-10-00')).toEqual([
      { start: at(8), end: at(9) },
      { start: at(9), end: at(10) },
    ])
  })

  it('reads an ordinary single label as one range', () => {
    expect(parseTimeRanges('01:00-02:00')).toEqual([{ start: at(1), end: at(2) }])
  })

  it('finds nothing in a cell that holds no time at all', () => {
    expect(parseTimeRanges('Monday')).toEqual([])
    expect(parseTimeRanges('')).toEqual([])
  })
})

describe('rebuilding a row that lost its dividing rule', () => {
  // rows: 08-09, 09-10, [10-11 + 11-12 merged into one 100px band], 12-01
  const axis = buildTimeAxis(
    [80, 130, 180, 280, 330],
    ['08:00-09:00', '09:00-10:00', '10:00-11:00 11:00-12:00', '12:00-01:00'],
  )

  it('cuts the band back into two rows at the right height', () => {
    expect(axis.ys).toEqual([80, 130, 180, 230, 280, 330])
  })

  it('gives each half its own hour, so 11:00-12:00 exists again', () => {
    expect(spans(axis)).toEqual([
      [at(8), at(9)],
      [at(9), at(10)],
      [at(10), at(11)],
      [at(11), at(12)],
      [at(12), at(13)],
    ])
  })

  it('says what it repaired instead of doing it silently', () => {
    expect(axis.warnings.join(' ')).toMatch(/2 time labels/)
  })

  it('leaves the axis with no holes', () => {
    const s = axis.slots.filter(Boolean)
    for (let i = 1; i < s.length; i++) expect(s[i]!.start).toBe(s[i - 1]!.end)
  })
})

describe('12-hour labels', () => {
  it('runs the afternoon forwards instead of back to 1 AM', () => {
    const axis = buildTimeAxis(
      [0, 50, 100, 150, 200, 250],
      ['11:00-12:00', '12:00-01:00', '01:00-02:00', '02:00-03:00', '03:00-04:00'],
    )
    expect(spans(axis)).toEqual([
      [at(11), at(12)],
      [at(12), at(13)],
      [at(13), at(14)],
      [at(14), at(15)],
      [at(15), at(16)],
    ])
  })

  it('leaves an unambiguous 24-hour table alone', () => {
    const axis = buildTimeAxis([0, 50, 100, 150], ['09:00-10:00', '13:00-14:00', '16:00-17:00'])
    expect(spans(axis)).toEqual([
      [at(9), at(10)],
      [at(13), at(14)],
      [at(16), at(17)],
    ])
  })
})

describe('labels that could not be read', () => {
  it('fills a gap in the middle from the row above', () => {
    const axis = buildTimeAxis([0, 50, 100, 150], ['09:00-10:00', '', '11:00-12:00'])
    expect(spans(axis)).toEqual([
      [at(9), at(10)],
      [at(10), at(11)],
      [at(11), at(12)],
    ])
    expect(axis.slots[1]!.inferred).toBe(true)
    expect(axis.slots[0]!.inferred).toBe(false)
  })

  it('fills a run at the top of the table from below', () => {
    // forward-only repair used to leave these null, which silently dropped
    // every class in the affected rows
    const axis = buildTimeAxis([0, 50, 100, 150], ['', '', '10:00-11:00'])
    expect(spans(axis)).toEqual([
      [at(8), at(9)],
      [at(9), at(10)],
      [at(10), at(11)],
    ])
    expect(axis.slots.every((s) => s !== null)).toBe(true)
  })

  it('picks up the period length from the document, not a hard-coded hour', () => {
    const axis = buildTimeAxis([0, 40, 80, 120], ['09:00-09:45', '', '10:30-11:15'])
    expect(axis.step).toBe(45)
    expect(spans(axis)[1]).toEqual([at(9, 45), at(10, 30)])
  })

  it('reports a table it could read nothing from', () => {
    const axis = buildTimeAxis([0, 50, 100], ['', ''])
    expect(axis.slots).toEqual([null, null])
    expect(axis.warnings.join(' ')).toMatch(/no time labels/)
  })
})

describe('an axis that does not tile the day', () => {
  it('reports an hour that no row covers rather than hiding it', () => {
    const axis = buildTimeAxis([0, 50, 100], ['08:00-09:00', '10:00-11:00'])
    expect(axis.gaps).toEqual([{ from: at(9), to: at(10) }])
    expect(axis.warnings.join(' ')).toMatch(/no row covers 09:00–10:00/)
  })

  it('reports no gap once a collapsed row has been repaired', () => {
    const axis = buildTimeAxis([0, 50, 150, 200], ['08:00-09:00', '09:00-10:00 10:00-11:00', '11:00-12:00'])
    expect(axis.gaps).toEqual([])
    expect(spans(axis)).toEqual([
      [at(8), at(9)],
      [at(9), at(10)],
      [at(10), at(11)],
      [at(11), at(12)],
    ])
  })

  it('trims two rows that claim the same minutes', () => {
    const axis = buildTimeAxis([0, 50, 100], ['08:00-10:00', '09:00-10:00'])
    expect(spans(axis)).toEqual([
      [at(8), at(9)],
      [at(9), at(10)],
    ])
    expect(axis.warnings.join(' ')).toMatch(/overlap/)
  })
})
