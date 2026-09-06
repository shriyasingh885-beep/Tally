import { describe, expect, it } from 'vitest'
import { detectGrid, fillImpliedRows, mergeRules } from './gridDetect'

/**
 * A stand-in for a canvas that detectGrid can read. The real pipeline only ever
 * asks for the pixels, so drawing a timetable by hand here lets the pixel
 * passes be tested for real — no browser, no OCR, no image fixtures.
 */
function raster(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 0
  }
  return {
    canvas: {
      width: w,
      height: h,
      getContext: () => ({ getImageData: () => ({ data }) }),
    } as unknown as HTMLCanvasElement,
    hline(y: number, x0: number, x1: number) {
      for (let x = x0; x <= x1; x++) set(x, y)
    },
    vline(x: number, y0: number, y1: number) {
      for (let y = y0; y <= y1; y++) set(x, y)
    },
    /** a few short dashes — ink shaped like words, never like a rule */
    text(x: number, y: number, dashes = 3) {
      for (let d = 0; d < dashes; d++) {
        for (let j = 0; j < 5; j++) for (let i = 0; i < 12; i++) set(x + d * 16 + i, y + j)
      }
    },
  }
}

const XS = [40, 160, 340, 520, 700, 880, 1060]
const MONDAY = 1
const FRIDAY = 5

/**
 * The "BE - II Year B" shape: a time gutter, five day columns, a header band
 * and ten one-hour rows.
 *
 * `erasedFullWidth` are boundaries drawn ONLY in the time gutter, exactly as a
 * merged 10:00-12:00 block on every weekday leaves them. `erasedInFriday` is a
 * boundary a single column merges across — the ordinary case.
 */
function timetable(opts: { ys: number[]; erasedFullWidth?: number[]; erasedInFriday?: number[] }) {
  const { ys, erasedFullWidth = [], erasedInFriday = [] } = opts
  const r = raster(1200, ys[ys.length - 1] + 40)
  for (const x of XS) r.vline(x, ys[0], ys[ys.length - 1])
  for (const y of ys) {
    if (erasedFullWidth.includes(y)) {
      r.hline(y, XS[0], XS[1]) // survives in the gutter, as aSc draws it
    } else if (erasedInFriday.includes(y)) {
      r.hline(y, XS[0], XS[FRIDAY])
    } else {
      r.hline(y, XS[0], XS[XS.length - 1])
    }
  }
  // label every row in the gutter and put something in a few cells
  for (let i = 1; i < ys.length; i++) {
    r.text(XS[0] + 10, Math.round((ys[i - 1] + ys[i]) / 2) - 2, 5)
    r.text(XS[MONDAY] + 20, Math.round((ys[i - 1] + ys[i]) / 2) - 2, 4)
  }
  return r
}

const near = (ys: number[], target: number) => ys.some((y) => Math.abs(y - target) <= 2)

describe('row boundaries a merged cell erased', () => {
  const YS = [40, 80, 130, 180, 230, 280, 330, 380, 430, 480, 530, 580]

  it('recovers a boundary every day column merged across', () => {
    // 230 is 11:00 — every weekday runs a 10:00-12:00 block, so the rule only
    // survives in the time gutter. This is the exact failure being guarded.
    const r = timetable({ ys: YS, erasedFullWidth: [230] })
    const grid = detectGrid(r.canvas)!
    expect(grid).not.toBeNull()
    for (const y of YS) expect(near(grid.ys, y), `boundary ${y} missing`).toBe(true)
  })

  it('recovers it even when the row rhythm cannot imply it', () => {
    // Uneven row heights, so the pitch heuristic is powerless: only the
    // per-column scan can find the gutter's surviving rule.
    const uneven = [40, 80, 130, 180, 230, 310, 360]
    expect(fillImpliedRows([40, 80, 130, 180, 310, 360])).not.toContain(230)
    const grid = detectGrid(timetable({ ys: uneven, erasedFullWidth: [230] }).canvas)!
    expect(near(grid.ys, 230)).toBe(true)
  })

  it('finds the day columns and the time gutter', () => {
    const grid = detectGrid(timetable({ ys: YS, erasedFullWidth: [230] }).canvas)!
    for (const x of XS) expect(near(grid.xs, x), `column ${x} missing`).toBe(true)
  })
})

describe('per-cell merge detection', () => {
  const YS = [40, 80, 130, 180, 230, 280, 330, 380, 430, 480, 530, 580]
  const grid = detectGrid(timetable({ ys: YS, erasedFullWidth: [230], erasedInFriday: [130] }).canvas)!

  const inColumn = (col: number, y: number) => grid.hasHLine(XS[col] + 4, XS[col + 1] - 4, y)

  it('reports no border where a column merged across a boundary', () => {
    // the recovered 11:00 boundary: no weekday draws it, so every one of them
    // must read as merged rather than as two separate one-hour classes
    for (let c = MONDAY; c <= FRIDAY; c++) expect(inColumn(c, 230), `column ${c}`).toBe(false)
    expect(inColumn(FRIDAY, 130)).toBe(false)
  })

  it('reports a border where one is drawn', () => {
    for (let c = MONDAY; c <= FRIDAY; c++) expect(inColumn(c, 280), `column ${c}`).toBe(true)
    expect(inColumn(MONDAY, 130)).toBe(true)
  })

  it('never mistakes a cell full of text for a border', () => {
    // ink at the same height as a row of words, nowhere near a boundary
    const mid = Math.round((180 + 230) / 2)
    for (let c = MONDAY; c <= FRIDAY; c++) expect(inColumn(c, mid), `column ${c}`).toBe(false)
  })
})

describe('rule bookkeeping', () => {
  it('restores a rule erased across every column (the 11:00 collapse)', () => {
    const ys = [10, 58, 106, 154, 250, 298, 346, 394]
    expect(fillImpliedRows(ys)).toEqual([10, 58, 106, 154, 202, 250, 298, 346, 394])
  })

  it('splits a triple-height collapse into three rows', () => {
    expect(fillImpliedRows([0, 50, 200, 250])).toEqual([0, 50, 100, 150, 200, 250])
  })

  it('leaves a uniform grid untouched', () => {
    const ys = [0, 50, 100, 150, 200, 250]
    expect(fillImpliedRows(ys)).toEqual(ys)
  })

  it('does not slice a merely tall header or an uneven row', () => {
    expect(fillImpliedRows([0, 75, 125, 175, 225, 305])).toEqual([0, 75, 125, 175, 225, 305])
  })

  it('merges recovered rules without disturbing the ones already found', () => {
    expect(mergeRules([0, 100, 200], [101, 150, 199])).toEqual([0, 100, 150, 200])
  })
})
