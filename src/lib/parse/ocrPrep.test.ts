import { describe, expect, it } from 'vitest'
import { binarize, estimateLineHeight, ocrScale, otsuThreshold } from './ocrPrep'

const SCALE_BASE = {
  targetLine: 32,
  targetCell: 150,
  maxWidth: 1600,
  maxHeight: 1000,
  maxScale: 6,
}

describe('choosing how far to magnify a cell', () => {
  it('scales by the size of the type, not the size of the cell', () => {
    // the same 9px type in a one-hour cell and in a two-hour merged one
    const oneHour = ocrScale({ ...SCALE_BASE, lineHeight: 9, cellWidth: 230, cellHeight: 50 })
    const twoHour = ocrScale({ ...SCALE_BASE, lineHeight: 9, cellWidth: 230, cellHeight: 100 })
    expect(oneHour).toBeCloseTo(twoHour)
    expect(twoHour).toBeCloseTo(32 / 9)
  })

  it('lifts a merged cell far above what cell-height scaling gave it', () => {
    // the old rule was targetCell / cellHeight — 150/100 = 1.5x, which left
    // 9px type at 13px and is a large part of why merged cells read so badly
    const merged = ocrScale({ ...SCALE_BASE, lineHeight: 9, cellWidth: 230, cellHeight: 100 })
    expect(merged).toBeGreaterThan(150 / 100)
    expect(merged * 9).toBeGreaterThan(30)
  })

  it('falls back to the cell when no line height could be measured', () => {
    expect(ocrScale({ ...SCALE_BASE, lineHeight: 0, cellWidth: 230, cellHeight: 50 })).toBeCloseTo(3)
  })

  it('never shrinks a cell, and never builds an absurd canvas', () => {
    expect(ocrScale({ ...SCALE_BASE, lineHeight: 90, cellWidth: 230, cellHeight: 300 })).toBe(1)
    const huge = ocrScale({ ...SCALE_BASE, lineHeight: 2, cellWidth: 900, cellHeight: 400 })
    expect(huge * 900).toBeLessThanOrEqual(1600)
    expect(huge * 400).toBeLessThanOrEqual(1000)
  })
})

describe('finding the line height in an ink profile', () => {
  const profile = (bands: Array<[number, number]>) => {
    const out: number[] = []
    for (const [blank, inked] of bands) {
      for (let i = 0; i < blank; i++) out.push(0)
      for (let i = 0; i < inked; i++) out.push(7)
    }
    return out
  }

  it('reads four lines of 9px type out of a merged cell', () => {
    expect(estimateLineHeight(profile([[6, 9], [4, 9], [4, 9], [4, 9]]))).toBe(9)
  })

  it('takes the median so one joined-up pair cannot skew it', () => {
    expect(estimateLineHeight(profile([[6, 9], [4, 20], [4, 9], [4, 9]]))).toBe(9)
  })

  it('reports nothing for an empty cell', () => {
    expect(estimateLineHeight([0, 0, 0, 0])).toBe(0)
  })
})

describe('flattening a cell to black on white', () => {
  /** build a w x h RGBA block of one grey, with a darker band through it */
  function block(w: number, h: number, bg: number, fg: number, bandRows: number[]) {
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = bandRows.includes(y) ? fg : bg
        const i = (y * w + x) * 4
        px[i] = px[i + 1] = px[i + 2] = v
        px[i + 3] = 255
      }
    }
    return px
  }
  const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4]

  it('turns grey haloed type into solid black on solid white', () => {
    const px = block(10, 10, 240, 90, [4, 5])
    binarize(px, 10, 10)
    expect(at(px, 10, 0, 4)).toBe(0)
    expect(at(px, 10, 0, 0)).toBe(255)
  })

  it('flips light text on a dark block the right way round', () => {
    // a filled lab cell: dark everywhere except the two rows of pale type
    const px = block(10, 10, 40, 230, [4, 5])
    binarize(px, 10, 10)
    expect(at(px, 10, 0, 4)).toBe(0) // the type became ink
    expect(at(px, 10, 0, 0)).toBe(255) // the fill became paper
  })

  it('leaves a blank cell as paper rather than inventing ink', () => {
    const px = block(10, 10, 250, 250, [])
    binarize(px, 10, 10)
    for (let y = 0; y < 10; y++) expect(at(px, 10, 0, y)).toBe(255)
  })
})

describe('otsu', () => {
  it('splits a two-peaked histogram between the peaks', () => {
    const hist = new Array<number>(256).fill(0)
    hist[40] = 500
    hist[220] = 500
    const t = otsuThreshold(hist)
    expect(t).toBeGreaterThanOrEqual(40)
    expect(t).toBeLessThan(220)
  })

  it('does not crash on an empty histogram', () => {
    expect(otsuThreshold(new Array<number>(256).fill(0))).toBe(128)
  })
})
