import type { ClassType, SourceCell } from '../../types'

/**
 * A cell exactly as it came out of the document, before we decide what any of
 * its lines mean. Keeping this raw form is what lets the classifier reason
 * about the timetable as a whole instead of guessing cell by cell.
 */
export interface RawCell {
  lines: string[]
  /** untouched text, kept so normalisation can never destroy information */
  originalText: string
  dayOfWeek: number
  startMin: number
  endMin: number
  source: SourceCell
  /** 0–1 OCR confidence, or 1 for a PDF text layer */
  ocrConfidence: number
  /** true when the row's time label had to be inferred rather than read */
  timeInferred: boolean
}

export interface ClassifiedCell {
  subject: string
  batch: string
  teacher: string
  room: string
  type: ClassType
}

/** Rooms carry a run of 2+ digits ("LAB105", "ATC-301"); batch ids don't. */
const ROOM_RE = /^[A-Z]{0,4}[-\s]?\d{2,4}[A-Z]?$/i
const ROOM_ANYWHERE_RE = /\b([A-Z]{1,4}[-\s]?\d{2,4}[A-Z]?)\b/i

export function looksLikeRoom(token: string): boolean {
  const t = token.trim()
  if (!t) return false
  if (ROOM_RE.test(t)) return true
  // any run of 2+ digits is a room/course code rather than a batch label
  return /\d{2,}/.test(t)
}

/**
 * Shape signature used only for diagnostics/grouping: letter and digit runs
 * with their lengths, separators preserved. "B1" -> "A1N1", "LAB105" -> "A3N3".
 */
export function shapeOf(token: string): string {
  return token
    .trim()
    .replace(/[A-Za-z]+/g, (m) => `A${m.length}`)
    .replace(/\d+/g, (m) => `N${m.length}`)
}

export interface Corpus {
  /** Batch identifiers this timetable actually uses, in source spelling. */
  batches: string[]
  hasBatchSystem: boolean
  /** fraction of cells that carry a room */
  roomCoverage: number
}

const MAX_BATCH_LEN = 8
const MAX_BATCH_CARDINALITY = 12
const MIN_BATCH_COVERAGE = 0.3

/**
 * Work out the timetable's batch/group system from the document itself.
 *
 * Nothing here is hard-coded to B1/B2/B3: a batch label is simply a short,
 * non-room token that keeps turning up *directly beneath the subject*. Faculty
 * initials sit a line lower, rooms carry long digit runs, and both fall out
 * naturally. A timetable with no batch concept yields an empty vocabulary.
 */
export function analyseCorpus(cells: RawCell[]): Corpus {
  const occ = new Map<string, number>()
  const atSubjectLine = new Map<string, number>()
  let withRoom = 0

  for (const cell of cells) {
    if (cell.lines.some((l) => looksLikeRoom(l) || ROOM_ANYWHERE_RE.test(l))) withRoom++
    // line 0 is the subject; everything below it is a candidate
    for (let i = 1; i < cell.lines.length; i++) {
      const token = cell.lines[i].trim()
      if (!token || token.length > MAX_BATCH_LEN) continue
      if (looksLikeRoom(token)) continue
      occ.set(token, (occ.get(token) ?? 0) + 1)
      if (i === 1) atSubjectLine.set(token, (atSubjectLine.get(token) ?? 0) + 1)
    }
  }

  const candidates: string[] = []
  for (const [token, count] of occ) {
    if (count < 2) continue
    // must sit immediately under the subject most of the time — that position
    // is what separates a batch label from faculty initials
    const positionAffinity = (atSubjectLine.get(token) ?? 0) / count
    if (positionAffinity >= 0.6) candidates.push(token)
  }

  // Once a batch system is established, a sibling that happens to appear only
  // once still belongs to it: "B2" alongside a confident "B1" is a batch, not
  // faculty. Generalise by shape rather than by any hard-coded vocabulary.
  const shapes = new Set(candidates.map(shapeOf))
  if (shapes.size) {
    for (const [token, count] of occ) {
      if (candidates.includes(token)) continue
      if ((atSubjectLine.get(token) ?? 0) < count) continue
      if (shapes.has(shapeOf(token))) candidates.push(token)
    }
  }

  const cellsWithCandidate = cells.filter((c) =>
    c.lines.slice(1).some((l) => candidates.includes(l.trim())),
  ).length
  const coverage = cells.length ? cellsWithCandidate / cells.length : 0

  const hasBatchSystem =
    candidates.length >= 1 && candidates.length <= MAX_BATCH_CARDINALITY && coverage >= MIN_BATCH_COVERAGE

  return {
    batches: hasBatchSystem ? candidates.sort((a, b) => a.localeCompare(b)) : [],
    hasBatchSystem,
    roomCoverage: cells.length ? withRoom / cells.length : 0,
  }
}

/** "ShV", "US", "MuS" — a couple of capitals in a short token means initials. */
function looksLikeInitials(token: string): boolean {
  const t = token.trim()
  if (t.length > 5) return false
  return (t.match(/[A-Z]/g)?.length ?? 0) >= 2
}

function classifyTypeFrom(subject: string): ClassType {
  if (/\blabs?\b|\bpractical\b/i.test(subject)) return 'lab'
  if (/\btut(orial)?\b/i.test(subject)) return 'tutorial'
  return 'lecture'
}

/**
 * Split one cell's lines into subject / batch / faculty / room using the
 * vocabulary inferred from the whole document plus positional convention.
 */
/**
 * Re-join a label the column was too narrow to hold on one line.
 *
 * A course code like "CE(T1-ME112)/CE(T2-MEDH1)" wraps across three lines in a
 * narrow column. Read line by line it becomes the subject "CE(T1", the room
 * "ME112" and a discarded remainder — a class that never existed, and a room
 * that is really half a batch code.
 *
 * A line that leaves a bracket open, or ends on a hyphen or slash, is
 * unfinished by the document's own punctuation, so the next line belongs to it.
 * That is a fact about the text rather than a guess about the timetable, which
 * is why it can run before anything is classified.
 */
export function joinWrappedLines(lines: string[]): string[] {
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const prev = out[out.length - 1]
    if (prev !== undefined && continues(prev)) {
      // no space where the break falls on a hyphen or slash, either side of it
      const tight = /[-/]$/.test(prev) || /^[-/]/.test(line)
      out[out.length - 1] = tight ? prev + line : `${prev} ${line}`
      continue
    }
    out.push(line)
  }
  return out
}

function continues(line: string): boolean {
  const opens = (line.match(/[([]/g) ?? []).length
  const closes = (line.match(/[)\]]/g) ?? []).length
  return opens > closes || /[-/]$/.test(line)
}

export function classifyCell(cell: RawCell, corpus: Corpus): ClassifiedCell | null {
  const lines = joinWrappedLines(cell.lines)
  if (!lines.length) return null

  const subjectParts: string[] = []
  let batch = ''
  let room = ''
  const facultyParts: string[] = []

  lines.forEach((line, i) => {
    if (i === 0) {
      subjectParts.push(line)
      return
    }
    if (!batch && corpus.batches.includes(line)) {
      batch = line
      return
    }
    if (!room && (looksLikeRoom(line) || ROOM_ANYWHERE_RE.test(line))) {
      const m = line.match(ROOM_ANYWHERE_RE)
      room = (m ? m[1] : line).replace(/\s+/g, '')
      return
    }
    facultyParts.push(line)
  })

  // A subject split across two lines by a narrow column: pull the second line
  // up only when the first is too short to be a name on its own. Three-letter
  // acronyms ("OOP", "COA", "DSD") are real subjects and must be left alone,
  // and initials like "ShV" are faculty, never the tail of a subject.
  let subject = subjectParts.join(' ').replace(/\s{2,}/g, ' ').trim()
  if (subject.length < 3 && facultyParts.length) {
    const candidate = facultyParts[0]
    if (candidate.length > 2 && !looksLikeInitials(candidate) && !corpus.batches.includes(candidate)) {
      subject = `${subject} ${candidate}`.trim()
      facultyParts.shift()
    }
  }
  if (!subject) return null

  return {
    subject,
    batch,
    teacher: facultyParts.join(' ').trim(),
    room,
    type: classifyTypeFrom(subject),
  }
}
