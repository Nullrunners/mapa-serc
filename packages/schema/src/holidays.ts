/**
 * Public holidays in Poland (ustawa o dniach wolnych od pracy), for the `PH` rules of `godziny_dostepnosci`:
 * an office open "Mo-Fr 08:00-16:00; PH off" is closed on 11 November even when it falls on a Tuesday.
 */

/** Easter Sunday in the Gregorian calendar (anonymous algorithm, Meeus/Jones/Butcher), as [month, day]. */
export function easter(year: number): [number, number] {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return [month, day]
}

const iso = (date: Date) => date.toISOString().slice(0, 10)

const cache = new Map<number, Set<string>>()

/** Every public holiday of `year` as YYYY-MM-DD. */
export function polishHolidays(year: number): Set<string> {
  let days = cache.get(year)
  if (days) return days
  const fixed = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26']
  // Wigilia has been a public holiday since 2025.
  if (year >= 2025) fixed.push('12-24')
  days = new Set(fixed.map((day) => `${year}-${day}`))
  const [month, day] = easter(year)
  const sunday = Date.UTC(year, month - 1, day)
  // Easter Sunday and Monday, Pentecost (7 weeks later) and Corpus Christi (the Thursday 60 days after Easter).
  for (const offset of [0, 1, 49, 60]) days.add(iso(new Date(sunday + offset * 86_400_000)))
  cache.set(year, days)
  return days
}

/** Whether YYYY-MM-DD is a public holiday in Poland. */
export const isPolishHoliday = (date: string): boolean => polishHolidays(Number(date.slice(0, 4))).has(date.slice(0, 10))
