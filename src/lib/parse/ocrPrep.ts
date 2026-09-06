/**
 * Getting a cell ready for Tesseract.
 *
 * Recognition quality on a timetable screenshot is decided almost entirely
 * before the recogniser is called: 9px type has to be blown up to something
 * readable, and it has to arrive as clean black on clean white. Both decisions
 * are made here, as plain functions over numbers, so they can be checked
 * without loading an OCR engine.
 */

/**
 * Otsu's method: the grey level that best splits a histogram into ink and paper.
 *
 * Done per cell rather than per page, which is what makes a coloured or shaded
 * cell work — its own local contrast decides the threshold instead of the
 * whitest cell on the sheet dragging it out of range.
 */
export function otsuThreshold(histogram: number[]): number {
  const total = histogram.reduce((s, n) => s + n, 0)
  if (!total) return 128

  let sum = 0
  for (let i = 0; i < histogram.length; i++) sum += i * histogram[i]

  let sumB = 0
  let weightB = 0
  let bestVariance = -1
  let threshold = 128
  for (let t = 0; t < histogram.length; t++) {
    weightB += histogram[t]
    if (!weightB) continue
    const weightF = total - weightB
    if (!weightF) break
    sumB += t * histogram[t]
    const meanB = sumB / weightB
    const meanF = (sum - sumB) / weightF
    const variance = weightB * weightF * (meanB - meanF) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      threshold = t
    }
  }
  return threshold
}

/**
 * Height of one line of type, from a cell's vertical ink profile.
 *
 * How far a cell must be scaled up depends on how tall its *letters* are, not
 * how tall the cell is — a two-hour block is twice the height of a one-hour one
 * but its type is exactly the same size. Scaling by cell height was blowing a
 * four-line merged cell up by only about 1.5x, handing Tesseract 13px letters
 * where it wants something nearer 30, which is a large part of why merged cells
 * read so much worse than ordinary ones.
 */
export function estimateLineHeight(rowInk: number[], minInk = 1): number {
  const bands: number[] = []
  let run = 0
  for (const n of rowInk) {
    if (n >= minInk) {
      run++
    } else if (run) {
      bands.push(run)
      run = 0
    }
  }
  if (run) bands.push(run)
  if (!bands.length) return 0
  return [...bands].sort((a, b) => a - b)[Math.floor(bands.length / 2)]
}

/**
 * How much to magnify a cell so its type lands in Tesseract's comfort zone,
 * bounded so a big merged cell can't produce an absurd canvas.
 */
export function ocrScale(opts: {
  lineHeight: number
  cellWidth: number
  cellHeight: number
  targetLine: number
  targetCell: number
  maxWidth: number
  maxHeight: number
  maxScale: number
}): number {
  const { lineHeight, cellWidth, cellHeight, targetLine, targetCell, maxWidth, maxHeight, maxScale } = opts
  // fall back to the cell when the profile was too noisy to find a line in
  const wanted = lineHeight > 1 ? targetLine / lineHeight : targetCell / Math.max(1, cellHeight)
  return Math.max(
    1,
    Math.min(maxScale, wanted, maxWidth / Math.max(1, cellWidth), maxHeight / Math.max(1, cellHeight)),
  )
}

/**
 * Flatten a region to black type on white paper, in place.
 *
 * Tesseract binarises internally anyway, but it does so across a whole image;
 * doing it per cell means a shaded row or a coloured lab block is judged on its
 * own contrast. If that leaves more ink than paper the cell was filled rather
 * than written on, so the result is flipped — light text on a dark block comes
 * out the right way round instead of as a solid rectangle.
 */
export function binarize(pixels: Uint8ClampedArray, width: number, height: number): void {
  const n = width * height
  if (n <= 0) return
  const grey = new Uint8Array(n)
  const histogram = new Array<number>(256).fill(0)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const g = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
    grey[p] = g
    histogram[g]++
  }

  const threshold = otsuThreshold(histogram)
  let dark = 0
  for (let p = 0; p < n; p++) if (grey[p] <= threshold) dark++
  const inverted = dark > n / 2

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const isInk = grey[p] <= threshold !== inverted
    const v = isInk ? 0 : 255
    pixels[i] = v
    pixels[i + 1] = v
    pixels[i + 2] = v
    pixels[i + 3] = 255
  }
}
