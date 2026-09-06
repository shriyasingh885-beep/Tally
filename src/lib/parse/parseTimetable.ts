import type { BreakPeriod, ClassDefinition, ClassType } from '../../types'
import { uid } from '../id'
import { clockToMinutes, minutesToClock, parseTimeToMinutes } from '../time'
import type { Extraction, Token } from './extractText'

export interface ParseResult {
  classes: ClassDefinition[]
  /** lunch and the like, kept out of the class list */
  breaks?: BreakPeriod[]
  /** false only when the file yielded no readable text at all */
  ok: boolean
  /** true when we read text but couldn't build a confident grid */
  partial?: boolean
  reason?: string
  /** structural repairs and unresolved gaps found while building the time axis */
  warnings?: string[]
}

const DAY_WORDS: Array<{ re: RegExp; dow: number }> = [
  { re: /^mon(day)?\.?$/i, dow: 1 },
  { re: /^tue(s|sd?ay)?\.?$/i, dow: 2 },
  { re: /^wed(nesday|nes|s)?\.?$/i, dow: 3 },
  { re: /^thu(r|rs|rsday)?\.?$/i, dow: 4 },
  { re: /^fri(day)?\.?$/i, dow: 5 },
  { re: /^sat(urday)?\.?$/i, dow: 6 },
  { re: /^sun(day)?\.?$/i, dow: 7 },
]

export function matchDay(raw: string): number | null {
  const w = raw.replace(/[^a-z]/gi, '')
  if (w.length < 3) return null
  for (const d of DAY_WORDS) if (d.re.test(w)) return d.dow
  return null
}

const ROOM_RE = /\b([A-Z]{1,4}[-\s]?\d{1,4}[A-Z]?)\b/
const RANGE_RE =
  /(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?)/i
const SINGLE_TIME_RE = /^\d{1,2}([:.]\d{2})?\s*([ap]\.?m\.?)?$/i

function groupLines(tokens: Token[]): Token[][] {
  if (!tokens.length) return []
  const hs = tokens.map((t) => t.h).sort((a, b) => a - b)
  const medH = hs[Math.floor(hs.length / 2)] || 10
  const tol = Math.max(4, medH * 0.7)
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Token[][] = []
  let cur: Token[] = []
  let curY = -Infinity
  for (const t of sorted) {
    if (cur.length && Math.abs(t.y - curY) > tol) {
      lines.push(cur)
      cur = []
    }
    cur.push(t)
    curY = cur.reduce((s, x) => s + x.y, 0) / cur.length
  }
  if (cur.length) lines.push(cur)
  return lines.map((l) => l.sort((a, b) => a.x - b.x))
}

function detectDayColumns(lines: Token[][]) {
  // First try: all day headers sit on one line (the common case).
  let best: { cols: { dow: number; x: number }[]; lineIndex: number } | null = null
  lines.forEach((line, i) => {
    const cols: { dow: number; x: number }[] = []
    for (const tok of line) {
      const dow = matchDay(tok.text)
      if (dow && !cols.some((c) => c.dow === dow)) cols.push({ dow, x: tok.x + tok.w / 2 })
    }
    if (cols.length >= 2 && (!best || cols.length > best.cols.length)) {
      best = { cols: cols.sort((a, b) => a.x - b.x), lineIndex: i }
    }
  })
  if (best && (best as { cols: unknown[] }).cols.length >= 3) return best

  // Fallback: OCR split the header across lines — gather every day token in the
  // top third of the page and cluster the strongest one per weekday by x.
  const cutoff = Math.floor(lines.length / 3) + 1
  const hits = new Map<number, { x: number; y: number; conf: number }>()
  let lastHeaderLine = 0
  lines.slice(0, Math.max(cutoff, 4)).forEach((line, i) => {
    for (const tok of line) {
      const dow = matchDay(tok.text)
      if (!dow) continue
      const prev = hits.get(dow)
      if (!prev || tok.conf > prev.conf) {
        hits.set(dow, { x: tok.x + tok.w / 2, y: tok.y, conf: tok.conf })
        lastHeaderLine = Math.max(lastHeaderLine, i)
      }
    }
  })
  if (hits.size >= 2) {
    const cols = [...hits.entries()]
      .map(([dow, v]) => ({ dow, x: v.x }))
      .sort((a, b) => a.x - b.x)
    return { cols, lineIndex: lastHeaderLine }
  }
  return best
}

interface RowAnchor {
  y: number
  startMin: number
  endMin: number | null
  /** no am/pm marker was present — eligible for the monotonic 12h→24h fix-up below */
  ambiguous: boolean
  /** the fix-up actually changed this anchor's hour — genuinely uncertain, worth a review flag */
  bumped: boolean
}

function detectTimeRows(lines: Token[][], headerLineIndex: number, firstColX: number): RowAnchor[] {
  const anchors: RowAnchor[] = []
  lines.forEach((line, i) => {
    if (i <= headerLineIndex) return
    const leftText = line
      .filter((t) => t.x + t.w <= firstColX + 8)
      .map((t) => t.text)
      .join(' ')
      .trim()
    const whole = line.map((t) => t.text).join(' ')
    const y = line.reduce((s, t) => s + t.y, 0) / line.length

    const range = (leftText || whole).match(RANGE_RE)
    if (range) {
      const s = parseTimeToMinutes(range[1])
      const e = parseTimeToMinutes(range[2])
      if (s != null)
        anchors.push({ y, startMin: s, endMin: e, ambiguous: !/[ap]\.?m/i.test(range[1]), bumped: false })
      return
    }
    if (leftText && SINGLE_TIME_RE.test(leftText.replace(/\s+/g, ''))) {
      const s = parseTimeToMinutes(leftText)
      if (s != null)
        anchors.push({ y, startMin: s, endMin: null, ambiguous: !/[ap]\.?m/i.test(leftText), bumped: false })
    }
  })

  // Resolve 12h ambiguity: enforce a non-decreasing schedule; bump afternoon slots.
  // A run of unmarked times that's already non-decreasing (the common 24h-style
  // "08:00-17:00" timetable) is left alone — only a genuine backwards jump gets
  // flagged, since that's the only case we're actually guessing at.
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i]
    if (a.ambiguous && a.startMin < anchors[i - 1].startMin && a.startMin < 12 * 60) {
      a.startMin += 12 * 60
      if (a.endMin != null && a.endMin < 12 * 60) a.endMin += 12 * 60
      a.bumped = true
    }
  }
  // Fill missing ends from the next anchor.
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].endMin == null) {
      anchors[i].endMin = anchors[i + 1] ? anchors[i + 1].startMin : anchors[i].startMin + 60
    }
  }
  return anchors
}

function classifyType(text: string): ClassType {
  if (/\blab\b|practical/i.test(text)) return 'lab'
  if (/\btut(orial)?\b/i.test(text)) return 'tutorial'
  return 'lecture'
}

function cleanSubject(text: string): string {
  return text
    .replace(ROOM_RE, ' ')
    .replace(/\b(lab|lecture|tut|tutorial|practical|room|hall)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .trim()
}

export function parseTimetable(ex: Extraction): ParseResult {
  const lines = groupLines(ex.tokens)
  if (!lines.length) return { classes: [], ok: false, reason: 'empty' }

  const header = detectDayColumns(lines)
  if (!header) return { classes: [], ok: true, partial: true, reason: 'no-days' }

  const cols = header.cols
  // Column x-boundaries: midpoints between day centres. The time-axis gutter
  // (left of the first day column) is excluded so row labels like "08:00-09:00"
  // never get mistaken for a Monday-column class.
  const avgGap = cols.length > 1 ? (cols[cols.length - 1].x - cols[0].x) / (cols.length - 1) : 160
  const gutterBoundary = cols[0].x - avgGap / 2
  const bounds: Array<{ dow: number; lo: number; hi: number }> = cols.map((c, i) => {
    const lo = i === 0 ? gutterBoundary : (cols[i - 1].x + c.x) / 2
    const hi = i === cols.length - 1 ? c.x + avgGap : (c.x + cols[i + 1].x) / 2
    return { dow: c.dow, lo, hi }
  })

  const rows = detectTimeRows(lines, header.lineIndex, cols[0].x)
  if (rows.length < 2) return { classes: [], ok: true, partial: true, reason: 'no-times' }

  const headerY = lines[header.lineIndex].reduce((s, t) => s + t.y, 0) / lines[header.lineIndex].length
  const bodyTokens = ex.tokens.filter((t) => t.y > headerY + 4 && t.x + t.w / 2 >= gutterBoundary)

  // Grid of cells [rowIndex][dowIndex] -> tokens
  const grid: Token[][][] = rows.map(() => bounds.map(() => []))
  for (const tok of bodyTokens) {
    const cx = tok.x + tok.w / 2
    const colIdx = bounds.findIndex((b) => cx >= b.lo && cx < b.hi)
    if (colIdx < 0) continue
    let rowIdx = -1
    let bestDist = Infinity
    for (let r = 0; r < rows.length; r++) {
      const top = rows[r].y - 6
      const bot = r + 1 < rows.length ? rows[r + 1].y - 6 : rows[r].y + 80
      if (tok.y >= top && tok.y < bot) {
        rowIdx = r
        break
      }
      const d = Math.abs(tok.y - rows[r].y)
      if (d < bestDist) {
        bestDist = d
        rowIdx = r
      }
    }
    if (rowIdx >= 0) grid[rowIdx][colIdx].push(tok)
  }

  const someRoom = bodyTokens.some((t) => ROOM_RE.test(t.text))
  const raw: Array<ClassDefinition & { _row: number; _col: number }> = []

  rows.forEach((row, r) => {
    bounds.forEach((b, c) => {
      const cellTokens = grid[r][c]
      if (!cellTokens.length) return
      const cellText = cellTokens
        .sort((a, z) => a.y - z.y || a.x - z.x)
        .map((t) => t.text)
        .join(' ')
        .trim()
      if (!cellText || /^[-–—.]+$/.test(cellText)) return

      const roomMatch = cellText.match(ROOM_RE)
      const subject = cleanSubject(cellText)
      const review: string[] = []
      if (!subject) review.push('subject')
      if (!roomMatch && someRoom) review.push('room')
      if (row.bumped) review.push('startTime')
      const lowConf = cellTokens.reduce((s, t) => s + t.conf, 0) / cellTokens.length < 0.6
      if (lowConf && !review.includes('subject')) review.push('subject')

      raw.push({
        id: uid('cls'),
        subject: subject || cellText.slice(0, 40),
        room: roomMatch ? roomMatch[1].replace(/\s+/g, '') : '',
        type: classifyType(cellText),
        dayOfWeek: b.dow,
        startTime: minutesToClock(row.startMin),
        endTime: minutesToClock(row.endMin ?? row.startMin + 60),
        review: review.length ? review : undefined,
        _row: r,
        _col: c,
      })
    })
  })

  // Merge stacked identical cells (double periods / labs spanning rows).
  raw.sort((a, z) => a._col - z._col || a._row - z._row)
  const merged: ClassDefinition[] = []
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  for (const cls of raw) {
    const prev = merged[merged.length - 1] as (ClassDefinition & { _row?: number; _col?: number }) | undefined
    const prevRaw = raw.find((x) => x.id === prev?.id)
    if (
      prev &&
      prevRaw &&
      prevRaw._col === cls._col &&
      cls._row - prevRaw._row === 1 &&
      norm(prev.subject) === norm(cls.subject)
    ) {
      if (clockToMinutes(cls.endTime) > clockToMinutes(prev.endTime)) prev.endTime = cls.endTime
      prevRaw._row = cls._row
      continue
    }
    const { _row, _col, ...clean } = cls
    void _row
    void _col
    merged.push(clean)
  }

  if (!merged.length) return { classes: [], ok: true, partial: true, reason: 'no-cells' }
  // Few cells relative to the detected grid usually means a messy source
  // (merged cells, batch-split labs) — flag it for a closer review.
  const partial = merged.length < Math.min(6, rows.length)
  return { classes: merged, ok: true, partial }
}
