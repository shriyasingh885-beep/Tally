/**
 * OCR of 8-10px timetable text is noisy, but a timetable repeats itself: the
 * same subject shows up five or six times across the week. "Limox Shell Prog",
 * "Limux Shell Prog" and "Limzx Shell Prog" are the same class read three ways,
 * so clustering the variants and electing one spelling fixes most of the damage
 * without needing better OCR.
 */

function normal(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array<number>(b.length + 1)
  let cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const t = prev
    prev = cur
    cur = t
  }
  return prev[b.length]
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  return 1 - levenshtein(a, b) / max
}

/** Tail junk OCR loves to invent: "OOP E]", "DSD 3)", "Physics 1". */
function trimJunk(s: string): string {
  let out = s.trim()
  out = out.replace(/[\s|]*[^\w\s]{1,3}$/u, '').trim()
  // a trailing 1-2 char orphan that isn't a real roman numeral or batch marker
  out = out.replace(/\s+(?![IViv]{1,4}$)[a-z0-9]{1,2}$/u, '').trim()
  // "Mathematics m" / "Mathematics rn" — a mangled "III"
  out = out.replace(/\s+(?:m|rn|ni|iii|ill|lll|11+)$/i, ' III').trim()
  return out.replace(/\s{2,}/g, ' ')
}

export interface CanonOptions {
  /** how alike two strings must be to merge (0-1) */
  threshold?: number
  /** clean obvious OCR tails before clustering */
  trim?: boolean
}

/**
 * Returns a map from each input value to the spelling elected for its cluster.
 * The winner is the most frequent variant, breaking ties on length (longer
 * readings usually lost fewer characters to OCR).
 */
export function canonicalize(values: string[], opts: CanonOptions = {}): Map<string, string> {
  const threshold = opts.threshold ?? 0.72
  const cleaned = new Map<string, string>()
  for (const v of values) cleaned.set(v, opts.trim === false ? v.trim() : trimJunk(v))

  const counts = new Map<string, number>()
  for (const v of values) {
    const c = cleaned.get(v)!
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }

  const uniques = [...counts.keys()].filter(Boolean)
  const clusters: string[][] = []
  for (const u of uniques) {
    const n = normal(u)
    let placed = false
    for (const cluster of clusters) {
      const rep = normal(cluster[0])
      // Long shared prefixes catch truncations that edit distance rates poorly.
      const prefix = Math.min(n.length, rep.length) >= 6 && n.slice(0, 6) === rep.slice(0, 6)
      const fuzzy = similarity(n, rep) >= threshold || prefix

      // Two readings that BOTH recur are two real subjects, not one subject
      // read two ways — "DS Lab" and "DSD Lab" are a deletion apart but are
      // different classes. Only merge established pairs on a pure substitution
      // of the same length; a rare variant can still merge loosely.
      // The allowance has to scale with length: two edits in a sixteen-letter
      // name is a misread, two edits in a three-letter acronym is a different
      // subject entirely ("COA" vs "OOP").
      const bothEstablished = (counts.get(u) ?? 0) >= 2 && (counts.get(cluster[0]) ?? 0) >= 2
      const allowance = Math.max(1, Math.floor(n.length / 6))
      const sameShape =
        n.length === rep.length && levenshtein(n, rep) <= allowance && similarity(n, rep) >= 0.8
      const mergeable = bothEstablished ? sameShape : fuzzy

      if (mergeable) {
        cluster.push(u)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([u])
  }

  /** share of characters that are letters or spaces — noise drags this down */
  const cleanliness = (s: string) => {
    if (!s.length) return 0
    let good = 0
    for (const ch of s) if (/[A-Za-z ]/.test(ch)) good++
    return good / s.length
  }

  const winner = new Map<string, string>()
  for (const cluster of clusters) {
    const best = cluster.slice().sort((a, b) => {
      const ca = counts.get(a) ?? 0
      const cb = counts.get(b) ?? 0
      if (ca !== cb) return cb - ca
      // Between equally common readings, prefer the one that looks like words
      // rather than the longest — length alone elects garbage like "00? Bl Bl".
      const qa = cleanliness(a)
      const qb = cleanliness(b)
      if (Math.abs(qa - qb) > 0.05) return qb - qa
      return b.length - a.length
    })[0]
    for (const member of cluster) winner.set(member, best)
  }

  const out = new Map<string, string>()
  for (const v of values) {
    const c = cleaned.get(v)!
    out.set(v, winner.get(c) ?? c)
  }
  return out
}
