const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function weekRangeLabel(days: Date[]): string {
  if (!days.length) return ''
  const a = days[0]
  const b = days[days.length - 1]
  const left = `${DOW_SHORT[a.getDay()]} ${a.getDate()} ${MONTHS[a.getMonth()]}`
  const right =
    a.getMonth() === b.getMonth()
      ? `${DOW_SHORT[b.getDay()]} ${b.getDate()} ${MONTHS[b.getMonth()]}`
      : `${DOW_SHORT[b.getDay()]} ${b.getDate()} ${MONTHS[b.getMonth()]}`
  return `${left} — ${right}`
}

export function dowShort(d: Date): string {
  return DOW_SHORT[d.getDay()].toUpperCase()
}

export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}
