/** Time helpers. All wall-clock strings are 24-hour "HH:MM" in the user's local zone. */

const TIME_RE = /^\s*(\d{1,2})\s*(?:[:.]\s*(\d{2}))?\s*([ap]\.?m\.?)?\s*$/i

/** Parse a loose time string ("9", "9:00", "9.00", "0900", "2:30 pm", "14:05") to minutes past midnight. */
export function parseTimeToMinutes(raw: string): number | null {
  if (!raw) return null
  let s = String(raw).trim().toLowerCase()

  // "0900" / "1430" compact form
  if (/^\d{3,4}$/.test(s)) {
    const n = s.padStart(4, '0')
    const h = Number(n.slice(0, 2))
    const m = Number(n.slice(2))
    if (h > 23 || m > 59) return null
    return h * 60 + m
  }

  const match = s.match(TIME_RE)
  if (!match) return null
  let h = Number(match[1])
  const m = match[2] ? Number(match[2]) : 0
  const mer = match[3] ? match[3].replace(/\./g, '') : null
  if (Number.isNaN(h) || Number.isNaN(m) || m > 59) return null
  if (mer === 'pm' && h < 12) h += 12
  if (mer === 'am' && h === 12) h = 0
  if (h > 23) return null
  return h * 60 + m
}

const RANGE_RE =
  /(\d{1,2}\s*[:.]?\s*\d{0,2}\s*(?:[ap]\.?m\.?)?)\s*(?:[-–—~]|to)\s*(\d{1,2}\s*[:.\-]?\s*\d{0,2}\s*(?:[ap]\.?m\.?)?)/i

/**
 * Parse a slot label like "08:00-09:00", "08:00-09-00" (a very common OCR
 * mangling), "9 - 10", "1:00-2:00 PM" into minutes past midnight.
 */
export function parseTimeRange(raw: string): { start: number; end: number | null } | null {
  if (!raw) return null
  const m = raw.replace(/\s+/g, ' ').match(RANGE_RE)
  if (!m) {
    const single = parseTimeToMinutes(raw.trim())
    return single == null ? null : { start: single, end: null }
  }
  const start = parseTimeToMinutes(m[1].replace(/\s+/g, ''))
  // "09-00" → "09:00"; a bare "09" stays 09:00
  const end = parseTimeToMinutes(m[2].replace(/\s+/g, '').replace(/^(\d{1,2})-(\d{2})$/, '$1:$2'))
  if (start == null) return null
  return { start, end }
}

export function minutesToClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** "9:00 AM" style label. */
export function minutesToLabel(min: number, opts: { withMinutes?: boolean } = {}): string {
  const m = ((min % 1440) + 1440) % 1440
  let h = Math.floor(m / 60)
  const mm = m % 60
  const mer = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  if (opts.withMinutes === false && mm === 0) return `${h} ${mer}`
  return `${h}:${String(mm).padStart(2, '0')} ${mer}`
}

export function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** yyyy-mm-dd for a Date, in LOCAL time (not UTC). */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local midnight for a yyyy-mm-dd string. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(d: Date): number {
  const g = d.getDay()
  return g === 0 ? 7 : g
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
