import type { ComponentType, SVGProps } from 'react'
import { useApp } from '../store/appStore'
import { IconAtom, IconBook, IconLaptop, IconSigma } from '../components/icons'

export interface SubjectStyle {
  bg: string
  ink: string
  barVar: string
}

const PALETTE: SubjectStyle[] = [
  { bg: 'var(--subj-blue-bg)', ink: 'var(--subj-blue-ink)', barVar: '--subj-blue-ink' },
  { bg: 'var(--subj-green-bg)', ink: 'var(--subj-green-ink)', barVar: '--subj-green-ink' },
  { bg: 'var(--subj-purple-bg)', ink: 'var(--subj-purple-ink)', barVar: '--subj-purple-ink' },
  { bg: 'var(--subj-pink-bg)', ink: 'var(--subj-pink-ink)', barVar: '--subj-pink-ink' },
  { bg: 'var(--subj-amber-bg)', ink: 'var(--subj-amber-ink)', barVar: '--subj-amber-ink' },
  { bg: 'var(--subj-teal-bg)', ink: 'var(--subj-teal-ink)', barVar: '--subj-teal-ink' },
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// A pure hash risks two subjects landing on the same colour (exactly what
// happened with "Mathematics" and "DSA" both hashing to blue). Instead we
// assign palette slots in alphabetical order across the whole timetable, so
// every subject gets a distinct colour until there are more subjects than
// palette entries — only then do we fall back to hashing.
let cacheFingerprint = ''
let cacheMap = new Map<string, SubjectStyle>()

function buildMap(subjects: string[]): Map<string, SubjectStyle> {
  const unique = [...new Set(subjects.map((s) => s.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
  const map = new Map<string, SubjectStyle>()
  unique.forEach((s, i) => map.set(s.toLowerCase(), PALETTE[i % PALETTE.length]))
  return map
}

/** A subject's pastel — distinct from every other subject in the current timetable where possible. */
export function subjectStyle(subject: string): SubjectStyle {
  const key = subject.trim().toLowerCase()
  if (!key) return PALETTE[0]

  const classes = useApp.getState().timetable?.classes
  const subjects = classes?.length ? classes.map((c) => c.subject) : [subject]
  const fingerprint = subjects.join('|')
  if (fingerprint !== cacheFingerprint) {
    cacheMap = buildMap(subjects)
    cacheFingerprint = fingerprint
  }
  return cacheMap.get(key) ?? PALETTE[hash(key) % PALETTE.length]
}

const KEYWORD_ICON: Array<{ re: RegExp; icon: ComponentType<SVGProps<SVGSVGElement>> }> = [
  { re: /math|calc|algebra|statistic/i, icon: IconSigma },
  { re: /physic/i, icon: IconAtom },
  { re: /data struct|computer|program|software|\bcs\b|dsa|algorithm/i, icon: IconLaptop },
]

/** Best-effort subject icon by keyword, falling back to a generic book. */
export function subjectIcon(subject: string): ComponentType<SVGProps<SVGSVGElement>> {
  const hit = KEYWORD_ICON.find((k) => k.re.test(subject))
  return hit?.icon ?? IconBook
}
