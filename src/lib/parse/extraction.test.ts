import { describe, expect, it } from 'vitest'
import type { RawCell } from './cellModel'
import { analyseCorpus, classifyCell, joinWrappedLines, looksLikeRoom } from './cellModel'
import { buildClasses } from './extractTimetable'
import { canonicalize } from './canonicalize'
import { batchMatches, filterByBatch, groupByTime, selectableBatches } from '../groupClasses'

const HOUR = 60
const at = (h: number) => h * HOUR

interface CellSpec {
  day: number
  start: number
  end: number
  lines: string[]
  lane?: number
  lanes?: number
  rowSpan?: number
  conf?: number
  timeInferred?: boolean
}

function cell(spec: CellSpec): RawCell {
  return {
    lines: spec.lines,
    originalText: spec.lines.join('\n'),
    dayOfWeek: spec.day,
    startMin: spec.start,
    endMin: spec.end,
    ocrConfidence: spec.conf ?? 0.95,
    timeInferred: spec.timeInferred ?? false,
    source: {
      row: Math.round(spec.start / HOUR),
      col: spec.day,
      rowSpan: spec.rowSpan ?? Math.max(1, Math.round((spec.end - spec.start) / HOUR)),
      lane: spec.lane ?? 0,
      lanes: spec.lanes ?? 1,
    },
  }
}

/**
 * The real "BE - II Year B" timetable, transcribed cell by cell from the
 * source document. This is the regression fixture: batches (B / B1 / B2 / B3 /
 * "A, B"), faculty initials, two-hour merged blocks, and slots split three
 * ways between parallel lab batches.
 */
const BE_II_YEAR_B: RawCell[] = [
  // ---- Monday ----
  cell({ day: 1, start: at(10), end: at(12), lines: ['OOP', 'B', 'US', 'ATC-301'] }),
  cell({ day: 1, start: at(13), end: at(14), lines: ['Mathematics III', 'B', 'ATC-309'] }),
  cell({ day: 1, start: at(14), end: at(16), lines: ['DSD Lab', 'B1'], lane: 0, lanes: 3 }),
  cell({ day: 1, start: at(14), end: at(16), lines: ['DS Lab', 'B2', 'LP, IK', 'LAB105'], lane: 1, lanes: 3 }),
  cell({ day: 1, start: at(14), end: at(16), lines: ['OOP Lab', 'B3', 'US, VM', 'Lab207'], lane: 2, lanes: 3 }),
  cell({ day: 1, start: at(16), end: at(18), lines: ['Linux Shell Prog', 'B2', 'PrKh, IK', 'Lab206'] }),

  // ---- Tuesday ----
  cell({ day: 2, start: at(10), end: at(12), lines: ['Linux Shell Prog', 'B1', 'NA, ShV', 'Lab206'], lane: 0, lanes: 2 }),
  cell({ day: 2, start: at(10), end: at(12), lines: ['Linux Shell Prog', 'B2', 'PrKh, IK', 'Lab204'], lane: 1, lanes: 2 }),
  cell({ day: 2, start: at(13), end: at(14), lines: ['Data Structures', 'A, B', 'LP', 'LT-201'] }),
  cell({ day: 2, start: at(14), end: at(15), lines: ['DSD', 'B', 'ATC-309'] }),
  cell({ day: 2, start: at(15), end: at(16), lines: ['Data Structures', 'B', 'MuS', 'ATC-309'] }),

  // ---- Wednesday ----
  cell({ day: 3, start: at(10), end: at(12), lines: ['DSD Lab', 'B2'], lane: 0, lanes: 3 }),
  cell({ day: 3, start: at(10), end: at(12), lines: ['DS Lab', 'B3', 'MuS, IK', 'LAB105'], lane: 1, lanes: 3 }),
  cell({ day: 3, start: at(10), end: at(12), lines: ['OOP Lab', 'B1', 'US, VM', 'Lab207'], lane: 2, lanes: 3 }),
  cell({ day: 3, start: at(13), end: at(14), lines: ['Mathematics III', 'B', 'LT-002'] }),
  cell({ day: 3, start: at(14), end: at(15), lines: ['DSD', 'B', 'LT-002'] }),
  cell({ day: 3, start: at(15), end: at(16), lines: ['COA', 'B', 'ShV', 'LT-002'] }),
  cell({ day: 3, start: at(16), end: at(17), lines: ['OOP', 'B', 'US', 'LT-002'] }),

  // ---- Thursday ----
  cell({ day: 4, start: at(10), end: at(12), lines: ['OOP', 'B', 'US', 'ATC-309'] }),
  cell({ day: 4, start: at(13), end: at(14), lines: ['DSD', 'B', 'LT-201'] }),
  cell({ day: 4, start: at(14), end: at(15), lines: ['COA', 'B', 'ShV', 'ATC-309'] }),
  cell({ day: 4, start: at(15), end: at(16), lines: ['Data Structures', 'B', 'MuS', 'LT-201'] }),
  cell({ day: 4, start: at(16), end: at(18), lines: ['Linux Shell Prog', 'B1', 'PrKh', 'Lab206'] }),

  // ---- Friday ----
  cell({ day: 5, start: at(8), end: at(10), lines: ['DSD Lab', 'B3'] }),
  cell({ day: 5, start: at(10), end: at(12), lines: ['Linux Shell Prog', 'B1', 'NA, ShV', 'Lab206'], lane: 0, lanes: 2 }),
  cell({ day: 5, start: at(10), end: at(12), lines: ['Linux Shell Prog', 'B3', 'AG, PrKh', 'Lab204'], lane: 1, lanes: 2 }),
  cell({ day: 5, start: at(13), end: at(14), lines: ['Data Structures', 'A, B', 'LP', 'LT-201'] }),
  cell({ day: 5, start: at(14), end: at(15), lines: ['Mathematics III', 'B', 'ATC-309'] }),
  cell({ day: 5, start: at(15), end: at(16), lines: ['COA', 'B', 'ShV', 'ATC-309'] }),
  cell({ day: 5, start: at(16), end: at(17), lines: ['DS Lab', 'B1', 'MuS, YS', 'LAB105'], lane: 0, lanes: 2 }),
  cell({ day: 5, start: at(16), end: at(17), lines: ['OOP Lab', 'B2', 'US, VM', 'Lab207'], lane: 1, lanes: 2 }),
]

const find = (classes: ReturnType<typeof buildClasses>['classes'], day: number, start: string) =>
  classes.filter((c) => c.dayOfWeek === day && c.startTime === start)

describe('batch system detection', () => {
  it('infers the batch vocabulary from the document', () => {
    const corpus = analyseCorpus(BE_II_YEAR_B)
    expect(corpus.hasBatchSystem).toBe(true)
    expect(corpus.batches).toEqual(expect.arrayContaining(['B', 'B1', 'B2', 'B3', 'A, B']))
  })

  it('never mistakes a room for a batch', () => {
    const corpus = analyseCorpus(BE_II_YEAR_B)
    for (const room of ['ATC-301', 'LAB105', 'Lab207', 'LT-002', 'Lab204']) {
      expect(corpus.batches).not.toContain(room)
      expect(looksLikeRoom(room)).toBe(true)
    }
  })

  it('never mistakes faculty initials for a batch', () => {
    const corpus = analyseCorpus(BE_II_YEAR_B)
    for (const faculty of ['US', 'MuS', 'ShV', 'PrKh, IK', 'NA, ShV', 'LP']) {
      expect(corpus.batches).not.toContain(faculty)
    }
  })

  it('adapts to a completely different batch naming scheme', () => {
    const cells = [
      cell({ day: 1, start: at(9), end: at(10), lines: ['Networks', 'IT-B1', 'AB', 'C101'] }),
      cell({ day: 1, start: at(10), end: at(11), lines: ['Networks', 'IT-B2', 'AB', 'C101'] }),
      cell({ day: 2, start: at(9), end: at(10), lines: ['Databases', 'IT-B1', 'CD', 'C102'] }),
      cell({ day: 2, start: at(10), end: at(11), lines: ['Databases', 'IT-B2', 'CD', 'C102'] }),
    ]
    const corpus = analyseCorpus(cells)
    expect(corpus.hasBatchSystem).toBe(true)
    expect(corpus.batches).toEqual(expect.arrayContaining(['IT-B1', 'IT-B2']))
  })

  it('reports no batch system when the timetable has none', () => {
    const cells = [
      cell({ day: 1, start: at(9), end: at(10), lines: ['Mathematics', 'Prof Rao', 'A101'] }),
      cell({ day: 1, start: at(10), end: at(11), lines: ['Physics', 'Prof Iyer', 'A102'] }),
      cell({ day: 2, start: at(9), end: at(10), lines: ['Chemistry', 'Prof Nair', 'A103'] }),
      cell({ day: 2, start: at(10), end: at(11), lines: ['Biology', 'Prof Das', 'A104'] }),
    ]
    expect(analyseCorpus(cells).hasBatchSystem).toBe(false)
    expect(selectableBatches(buildClasses(cells).classes)).toEqual([])
  })
})

describe('cell field classification', () => {
  const corpus = analyseCorpus(BE_II_YEAR_B)

  it('splits subject / batch / faculty / room without merging them', () => {
    const parsed = classifyCell(BE_II_YEAR_B[0], corpus)
    expect(parsed).toEqual({
      subject: 'OOP',
      batch: 'B',
      teacher: 'US',
      room: 'ATC-301',
      type: 'lecture',
    })
  })

  it('keeps a composite batch label intact', () => {
    const ds = BE_II_YEAR_B.find((c) => c.lines[1] === 'A, B')!
    expect(classifyCell(ds, corpus)?.batch).toBe('A, B')
  })

  it('marks lab sessions as labs', () => {
    const lab = BE_II_YEAR_B.find((c) => c.lines[0] === 'OOP Lab')!
    expect(classifyCell(lab, corpus)?.type).toBe('lab')
    expect(classifyCell(BE_II_YEAR_B[0], corpus)?.type).toBe('lecture')
  })
})

describe('the BE - II Year B timetable end to end', () => {
  const { classes, corpus } = buildClasses(BE_II_YEAR_B)

  it('keeps every source cell as its own class', () => {
    expect(classes).toHaveLength(BE_II_YEAR_B.length)
  })

  it('reads a vertically merged block as one two-hour class', () => {
    const mondayOop = find(classes, 1, '10:00')
    expect(mondayOop).toHaveLength(1)
    expect(mondayOop[0]).toMatchObject({ subject: 'OOP', endTime: '12:00', room: 'ATC-301', batch: 'B' })
  })

  it('keeps three parallel batch labs in the same slot as three classes', () => {
    const wed = find(classes, 3, '10:00')
    expect(wed).toHaveLength(3)
    expect(wed.map((c) => c.batch).sort()).toEqual(['B1', 'B2', 'B3'])
    expect(wed.map((c) => c.subject).sort()).toEqual(['DS Lab', 'DSD Lab', 'OOP Lab'])
    for (const c of wed) expect(c.endTime).toBe('12:00')
  })

  it('does not collapse "DS Lab" into "DSD Lab"', () => {
    const subjects = new Set(classes.map((c) => c.subject))
    expect(subjects.has('DS Lab')).toBe(true)
    expect(subjects.has('DSD Lab')).toBe(true)
    expect(subjects.has('DSD')).toBe(true)
  })

  it('assigns rooms to rooms and batches to batches', () => {
    for (const c of classes) {
      if (c.batch) expect(/\d{2,}/.test(c.batch)).toBe(false)
      if (c.room) expect(looksLikeRoom(c.room)).toBe(true)
    }
  })

  it('recovers every distinct subject in the source', () => {
    const subjects = new Set(classes.map((c) => c.subject))
    for (const expected of [
      'OOP',
      'OOP Lab',
      'DSD',
      'DSD Lab',
      'DS Lab',
      'COA',
      'Mathematics III',
      'Data Structures',
      'Linux Shell Prog',
    ]) {
      expect(subjects).toContain(expected)
    }
  })

  it('places Friday morning lab at 8-10 and the split slot at 4pm', () => {
    expect(find(classes, 5, '08:00')[0]).toMatchObject({ subject: 'DSD Lab', endTime: '10:00', batch: 'B3' })
    const fridayFour = find(classes, 5, '16:00')
    expect(fridayFour).toHaveLength(2)
    expect(fridayFour.map((c) => c.batch).sort()).toEqual(['B1', 'B2'])
  })

  it('is confident about the document it just read', () => {
    const shaky = classes.filter((c) => (c.confidence ?? 0) < 0.6)
    expect(shaky).toHaveLength(0)
  })

  it('records where each class came from', () => {
    for (const c of classes) {
      expect(c.sourceCell).toBeDefined()
      expect(c.originalText).toBeTruthy()
    }
    expect(corpus.roomCoverage).toBeGreaterThan(0.6)
  })
})

describe('validation', () => {
  it('drops impossible times and keeps legitimate same-slot classes', () => {
    const cells = [
      cell({ day: 1, start: at(9), end: at(9), lines: ['Broken', 'B1', 'A101'] }), // zero length
      cell({ day: 9, start: at(9), end: at(10), lines: ['Bad Day', 'B1', 'A101'] }), // invalid day
      cell({ day: 1, start: at(10), end: at(11), lines: ['Real', 'B1', 'A101'] }),
      cell({ day: 1, start: at(10), end: at(11), lines: ['Real Other', 'B2', 'A102'] }),
    ]
    const { classes } = buildClasses(cells)
    expect(classes.map((c) => c.subject).sort()).toEqual(['Real', 'Real Other'])
  })

  it('removes an exact duplicate but not a same-slot sibling', () => {
    const same = { day: 1, start: at(10), end: at(11), lines: ['Physics', 'B1', 'LP', 'A101'] }
    const { classes } = buildClasses([cell(same), cell(same), cell({ ...same, lines: ['Physics', 'B2', 'LP', 'A101'] })])
    expect(classes).toHaveLength(2)
    expect(classes.map((c) => c.batch).sort()).toEqual(['B1', 'B2'])
  })

  it('flags a low-confidence reading for review instead of presenting it as fact', () => {
    const cells = [
      cell({ day: 1, start: at(9), end: at(10), lines: ['Networks', 'B1', 'C101'] }),
      cell({ day: 1, start: at(10), end: at(11), lines: ['Networks', 'B2', 'C101'] }),
      cell({ day: 2, start: at(9), end: at(10), lines: ['0O?', 'B1', 'C101'], conf: 0.25 }),
    ]
    const { classes } = buildClasses(cells)
    // the junk cell is the only one on day 2; its subject text is cleaned up
    // during canonicalisation so match on position, not on the raw string
    const junk = classes.find((c) => c.dayOfWeek === 2)
    expect(junk).toBeDefined()
    expect(junk!.confidence).toBeLessThan(0.6)
    expect(junk!.review).toContain('subject')
    // the unreadable original is preserved rather than thrown away
    expect(junk!.originalText).toContain('0O?')
  })
})

describe('subject canonicalisation', () => {
  it('folds OCR variants of one subject together', () => {
    const map = canonicalize(['Limux Shell Prog', 'Limox Shell Prog', 'Limux Shell Prog', 'Limux Shell Prog'])
    expect(new Set([...map.values()]).size).toBe(1)
  })

  it('keeps two recurring subjects that differ by a real word apart', () => {
    const map = canonicalize(['DS Lab', 'DS Lab', 'DSD Lab', 'DSD Lab', 'DSD Lab'])
    expect(new Set([...map.values()]).size).toBe(2)
  })

  it('assembles a spelling that no single cell got right', () => {
    // three readings, each fumbling a different letter: electing a whole
    // variant can only ever return one of these three, all of them wrong
    const map = canonicalize(['Limux Shell Prog', 'Linux Sheli Prog', 'Linux Shell Prpg'])
    expect(new Set([...map.values()])).toEqual(new Set(['Linux Shell Prog']))
  })

  it('settles capitalisation by majority per letter', () => {
    const map = canonicalize(['oOP Lab', 'OoP Lab', 'OOp Lab'])
    expect(new Set([...map.values()])).toEqual(new Set(['OOP Lab']))
  })

  it('recovers a letter the majority dropped', () => {
    const map = canonicalize(['Mathematcs III', 'Mathematics III', 'Mathematics III'])
    expect(new Set([...map.values()])).toEqual(new Set(['Mathematics III']))
  })

  it('leaves a subject every cell agreed on exactly as it was', () => {
    const map = canonicalize(['Data Structures', 'Data Structures', 'Data Structures'])
    expect(new Set([...map.values()])).toEqual(new Set(['Data Structures']))
  })

  it('does not let a consistent misread be voted away', () => {
    // when every cell makes the SAME mistake there is nothing to vote with;
    // the review screen is what catches these, and it must not pretend otherwise
    const map = canonicalize(['Limux Shell Prog', 'Limux Shell Prog', 'Limux Shell Prog'])
    expect(new Set([...map.values()])).toEqual(new Set(['Limux Shell Prog']))
  })
})

describe('mobile grouping and batch filter', () => {
  const { classes } = buildClasses(BE_II_YEAR_B)
  const wednesday = classes.filter((c) => c.dayOfWeek === 3)

  it('shows one time heading for three parallel classes', () => {
    const groups = groupByTime(wednesday)
    const tenAm = groups.find((g) => g.startTime === '10:00')!
    expect(tenAm.classes).toHaveLength(3)
    expect(tenAm.endTime).toBe('12:00')
    // one heading, not three repeated ones
    expect(groups.filter((g) => g.startTime === '10:00')).toHaveLength(1)
  })

  it('orders groups chronologically', () => {
    const starts = groupByTime(wednesday).map((g) => g.startMin)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('offers each batch separately, composites expanded', () => {
    expect(selectableBatches(classes)).toEqual(['A', 'B', 'B1', 'B2', 'B3'])
  })

  it('filters a slot down to the selected batch', () => {
    const tenAm = wednesday.filter((c) => c.startTime === '10:00')
    expect(filterByBatch(tenAm, 'B3')).toHaveLength(1)
    expect(filterByBatch(tenAm, 'B3')[0].subject).toBe('DS Lab')
    expect(filterByBatch(tenAm, null)).toHaveLength(3)
  })

  it('keeps whole-class lectures visible when a sub-batch is selected', () => {
    // "B" is the parent of B1/B2/B3 — a B lecture is attended by all of them.
    expect(batchMatches('B', 'B3')).toBe(true)
    expect(batchMatches('B1', 'B3')).toBe(false)
    const monday = classes.filter((c) => c.dayOfWeek === 1)
    const forB3 = filterByBatch(monday, 'B3')
    const subjects = forB3.map((c) => c.subject).sort()
    // the two whole-class lectures plus B3's own lab, and nothing from B1/B2
    expect(subjects).toEqual(['Mathematics III', 'OOP', 'OOP Lab'])
  })

  it('shows every sub-batch when the parent batch is selected', () => {
    const monday = classes.filter((c) => c.dayOfWeek === 1)
    expect(filterByBatch(monday, 'B')).toHaveLength(monday.length)
  })

  it('keeps a shared "A, B" lecture visible for both batches', () => {
    expect(batchMatches('A, B', 'A')).toBe(true)
    expect(batchMatches('A, B', 'B')).toBe(true)
    expect(batchMatches('B1', 'B2')).toBe(false)
    const friday = classes.filter((c) => c.dayOfWeek === 5)
    const forA = filterByBatch(friday, 'A')
    expect(forA.some((c) => c.subject === 'Data Structures')).toBe(true)
  })

  it('keeps unbatched classes visible under every filter', () => {
    const cells = [
      cell({ day: 1, start: at(9), end: at(10), lines: ['Assembly', 'Hall'] }),
      cell({ day: 1, start: at(10), end: at(11), lines: ['Networks', 'B1', 'C101'] }),
      cell({ day: 1, start: at(11), end: at(12), lines: ['Networks', 'B2', 'C101'] }),
    ]
    const built = buildClasses(cells).classes
    const assembly = built.find((c) => c.subject === 'Assembly')!
    expect(assembly.batch).toBeUndefined()
    expect(filterByBatch(built, 'B1').map((c) => c.subject)).toContain('Assembly')
  })
})

describe('subjects that merely start alike', () => {
  it('keeps Applied Physics and Applied Chemistry apart', () => {
    const map = canonicalize(['Applied Physics', 'Applied Chemistry'])
    expect(new Set([...map.values()])).toEqual(new Set(['Applied Physics', 'Applied Chemistry']))
  })

  it('keeps two Mathematics courses apart', () => {
    const map = canonicalize(['Mathematics for Engineers', 'Mathematics III'])
    expect(new Set([...map.values()])).toEqual(new Set(['Mathematics for Engineers', 'Mathematics III']))
  })

  it('never votes its way to a word that was never read', () => {
    // the regression this guards: a bad merge plus per-character voting once
    // produced "Applied Phemysics", which is not a subject anywhere
    for (const v of canonicalize(['Applied Physics', 'Applied Chemistry']).values()) {
      expect(['Applied Physics', 'Applied Chemistry']).toContain(v)
    }
  })

  it('still folds a genuine truncation back together', () => {
    const map = canonicalize(['Linux Shell Prog', 'Linux Shell Pro', 'Linux Shell Prog'])
    expect(new Set([...map.values()]).size).toBe(1)
  })

  it('keeps a course code and its brackets intact', () => {
    const codes = ['CE(T)(CH)', 'CE(L)(MA)', 'CE(T)(IT)', 'CE(L)(IT)']
    const map = canonicalize(codes)
    for (const c of codes) expect(map.get(c)).toBe(c)
  })
})

describe('lunch is not a class', () => {
  const withLunch: RawCell[] = [
    cell({ day: 1, start: at(11), end: at(12), lines: ['Applied Physics', 'B', 'LT-002'] }),
    cell({ day: 1, start: at(12) + 45, end: at(14), lines: ['LUNCH BREAK'] }),
    cell({ day: 2, start: at(12) + 45, end: at(14), lines: ['LUNCH BREAK'] }),
    cell({ day: 3, start: at(12) + 45, end: at(14), lines: ['LUNCH BREAK'] }),
    cell({ day: 1, start: at(14), end: at(15), lines: ['Applied Chemistry', 'B', 'LT-002'] }),
  ]

  it('keeps it out of the class list entirely', () => {
    const { classes } = buildClasses(withLunch)
    expect(classes.map((c) => c.subject)).toEqual(['Applied Physics', 'Applied Chemistry'])
  })

  it('returns it once, not once per day column', () => {
    const { breaks } = buildClasses(withLunch)
    expect(breaks).toHaveLength(1)
    expect(breaks[0]).toMatchObject({ label: 'Lunch break', startTime: '12:45', endTime: '14:00' })
  })

  it('leaves a timetable without breaks alone', () => {
    expect(buildClasses(BE_II_YEAR_B).breaks).toEqual([])
  })

  it('does not let the two Applied subjects merge into one another', () => {
    const subjects = buildClasses(withLunch).classes.map((c) => c.subject)
    expect(new Set(subjects).size).toBe(2)
  })
})

describe('labels the column was too narrow to hold', () => {
  it('rejoins a code split across three lines', () => {
    expect(joinWrappedLines(['CE(T1-', 'ME112)/CE(T2-', 'MEDH1)'])).toEqual(['CE(T1-ME112)/CE(T2-MEDH1)'])
  })

  it('closes a bracket left open on the line before', () => {
    expect(joinWrappedLines(['CE(P1-PH)/CE(P2', '-CH)'])).toEqual(['CE(P1-PH)/CE(P2-CH)'])
  })

  it('leaves ordinary cell lines alone', () => {
    expect(joinWrappedLines(['OOP', 'B', 'US', 'ATC-301'])).toEqual(['OOP', 'B', 'US', 'ATC-301'])
  })

  it('does not glue a room onto a finished subject', () => {
    expect(joinWrappedLines(['Mathematics III', 'B', 'ATC-309'])).toEqual(['Mathematics III', 'B', 'ATC-309'])
  })

  it('stops a wrapped code being read as a class plus a room', () => {
    const corpus = analyseCorpus(BE_II_YEAR_B)
    const parsed = classifyCell(
      cell({ day: 1, start: at(10), end: at(12), lines: ['CE(T1-', 'ME112)/CE(T2-', 'MEDH1)'] }),
      corpus,
    )
    expect(parsed?.subject).toBe('CE(T1-ME112)/CE(T2-MEDH1)')
    expect(parsed?.room).toBe('')
  })
})
