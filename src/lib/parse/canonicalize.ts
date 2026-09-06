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

/**
 * The single-letter tokens in a normalised label, in order.
 *
 * In a course code they carry the entire meaning: the L and T of "CE(L)(IT)"
 * and "CE(T)(IT)" are the lecture and the tutorial of one subject — one edit
 * apart, and different classes that meet at different times. Fuzzy matching
 * rates them 86% alike and would happily merge them, so they have to agree
 * before similarity is even consulted. Ordinary subject names have none of
 * these, so nothing else is affected.
 */
function markers(s: string): string {
  return s
    .split(' ')
    .filter((t) => t.length === 1)
    .join('')
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  return 1 - levenshtein(a, b) / max
}

/** Does a trailing bracket close one that the string actually opened? */
function closesAPair(s: string): boolean {
  const opens = (s.match(/[([]/g) ?? []).length
  const closes = (s.match(/[)\]]/g) ?? []).length
  return /[)\]]$/.test(s) && opens >= closes
}

/** Tail junk OCR loves to invent: "OOP E]", "DSD 3)", "Physics 1". */
function trimJunk(s: string): string {
  let out = s.trim()
  // ...but a bracket closing one the subject opened belongs to its name: course
  // codes like "CE(T)(CH)" and "CE(P1-PH)/CE(P2-CH)" are not OCR debris.
  if (!closesAPair(out)) out = out.replace(/[\s|]*[^\w\s]{1,3}$/u, '').trim()
  // a trailing 1-2 char orphan that isn't a real roman numeral or batch marker
  out = out.replace(/\s+(?![IViv]{1,4}$)[a-z0-9]{1,2}$/u, '').trim()
  // "Mathematics m" / "Mathematics rn" — a mangled "III"
  out = out.replace(/\s+(?:m|rn|ni|iii|ill|lll|11+)$/i, ' III').trim()
  return out.replace(/\s{2,}/g, ' ')
}

/**
 * Align `other` onto `spine`, Needleman-Wunsch, and report what landed where.
 * `at[i]` is the character of `other` that lines up with `spine[i]` ('' if the
 * reading dropped it); `before[i]` is anything it inserted ahead of that spot.
 */
function align(spine: string, other: string): { at: string[]; before: string[] } {
  const n = spine.length
  const m = other.length
  const MATCH = 2
  const MIS = -1
  const GAP = -2
  const score = (i: number, j: number) =>
    spine[i].toLowerCase() === other[j].toLowerCase() ? MATCH : MIS

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) dp[i][0] = i * GAP
  for (let j = 1; j <= m; j++) dp[0][j] = j * GAP
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.max(dp[i - 1][j - 1] + score(i - 1, j - 1), dp[i - 1][j] + GAP, dp[i][j - 1] + GAP)
    }
  }

  const at = new Array<string>(n).fill('')
  const before = new Array<string>(n + 1).fill('')
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + score(i - 1, j - 1)) {
      at[i - 1] = other[j - 1]
      i--
      j--
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP) {
      i--
    } else if (j > 0) {
      before[i] = other[j - 1] + before[i]
      j--
    } else {
      i--
    }
  }
  return { at, before }
}

/** letters beat digits beat punctuation beat nothing, when votes are level */
function rank(ch: string): number {
  if (!ch) return 0
  if (/[a-z]/i.test(ch)) return 3
  if (/\d/.test(ch)) return 2
  return 1
}

/**
 * The winning character for one column of the vote.
 *
 * Case is decided separately from identity: "oop", "OoP" and "OOP" all agree
 * there is an O here, so they are counted together first and the capitalisation
 * settled afterwards. Otherwise three differently-cased readings would look
 * like three different characters and none would reach a majority.
 */
function pick(votes: Map<string, number>): string {
  const folded = new Map<string, number>()
  for (const [ch, n] of votes) {
    const k = ch.toLowerCase()
    folded.set(k, (folded.get(k) ?? 0) + n)
  }
  let key = ''
  let keyVotes = -1
  for (const [k, n] of folded) {
    if (n > keyVotes || (n === keyVotes && rank(k) > rank(key))) {
      key = k
      keyVotes = n
    }
  }
  let best = key
  let bestVotes = -1
  for (const [ch, n] of votes) {
    if (ch.toLowerCase() !== key) continue
    if (n > bestVotes) {
      bestVotes = n
      best = ch
    }
  }
  return best
}

/**
 * Vote on a cluster character by character instead of picking a whole reading.
 *
 * Electing the most common variant can only ever return a spelling that some
 * cell actually produced, so a subject nobody read correctly stays wrong
 * forever. Voting per character can assemble the right word out of readings
 * that were each wrong in a different place: "Limux"/"Sheli"/"Prpg" agree on
 * every letter except the one each of them fumbled.
 *
 * It cannot rescue a mistake OCR makes *consistently* — if every cell reads the
 * same wrong letter, that letter wins the vote. Those need a human, which is
 * what the review screen is for.
 */
export function consensus(spine: string, variants: Array<{ text: string; count: number }>): string {
  if (variants.length < 2) return spine
  const at = Array.from({ length: spine.length }, () => new Map<string, number>())
  const ins = Array.from({ length: spine.length + 1 }, () => new Map<string, number>())
  let total = 0

  const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n)

  for (const v of variants) {
    if (!v.count) continue
    total += v.count
    const a = align(spine, v.text)
    for (let i = 0; i < spine.length; i++) bump(at[i], a.at[i], v.count)
    for (let i = 0; i <= spine.length; i++) bump(ins[i], a.before[i], v.count)
  }
  if (total < 2) return spine

  let out = ''
  for (let i = 0; i <= spine.length; i++) {
    // an insertion has to be agreed by an outright majority to make the cut
    const extra = pick(ins[i])
    if (extra && (ins[i].get(extra) ?? 0) * 2 > total) out += extra
    if (i < spine.length) out += pick(at[i])
  }
  return out.replace(/\s{2,}/g, ' ').trim()
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
      // A truncation means one reading IS the start of the other, missing only a
      // short tail — "Limux Shell Pro" for "Limux Shell Prog". Merely opening
      // with the same word is not: a timetable full of "Applied Physics" and
      // "Applied Chemistry", or "Mathematics III" and "Mathematics for
      // Engineers", would otherwise collapse subjects that share nothing.
      const [shorter, longer] = n.length <= rep.length ? [n, rep] : [rep, n]
      const prefix =
        shorter.length >= 6 &&
        longer.startsWith(shorter) &&
        longer.length - shorter.length <= Math.max(2, Math.round(longer.length * 0.2))
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
      const mergeable = (bothEstablished ? sameShape : fuzzy) && markers(n) === markers(rep)

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

    // Then let the whole cluster vote character by character, which can arrive
    // at a spelling no single cell produced. Only adopt it if it still looks
    // like the reading it came from and reads at least as cleanly — a vote
    // should refine the winner, never replace it with something unrecognisable.
    const voted = consensus(
      best,
      cluster.map((c) => ({ text: c, count: counts.get(c) ?? 0 })),
    )
    // 0.85, not 0.6: a vote is meant to correct a character here and there. A
    // result that has drifted further is not a better reading of the same
    // subject but an invention — "Applied Physics" and "Applied Chemistry" once
    // voted their way to "Applied Phemysics" — so keep the real spelling.
    const elected =
      voted && similarity(normal(voted), normal(best)) >= 0.85 && cleanliness(voted) >= cleanliness(best)
        ? voted
        : best

    for (const member of cluster) winner.set(member, elected)
  }

  const out = new Map<string, string>()
  for (const v of values) {
    const c = cleaned.get(v)!
    out.set(v, winner.get(c) ?? c)
  }
  return out
}
