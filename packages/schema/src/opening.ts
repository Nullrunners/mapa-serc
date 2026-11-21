/**
 * Reads `godziny_dostepnosci` (the subset of OpenStreetMap's `opening_hours` syntax that the pattern uses) and
 * answers one question: can the device be reached at a given moment?
 *
 * Understood: `24/7`, weekday lists and ranges, time ranges (also past midnight), `off`, rules separated by `;`
 * where a later rule replaces an earlier one for the days it names. Anything else (public holidays, months,
 * sunrise, comments) gives "unknown": a wrong "open" would send a rescuer to a locked door.
 */
import type { AedRecord } from './fields'

export type Availability = 'open' | 'closed' | 'unknown'

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const DAY_MINUTES = 24 * 60

interface Rule {
  days: Set<number>
  /** Minutes from midnight; an end beyond 1440 runs into the next day. */
  ranges: [number, number][]
}

function minutes(text: string | undefined): number | null {
  const match = text?.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const value = Number(match[1]) * 60 + Number(match[2])
  return Number(match[2]) < 60 && value <= DAY_MINUTES ? value : null
}

function parseDays(text: string): Set<number> | null {
  const days = new Set<number>()
  for (const part of text.split(',')) {
    const [first, last, ...rest] = part.split('-')
    const from = DAYS.indexOf(first ?? '')
    const to = last === undefined ? from : DAYS.indexOf(last)
    if (rest.length > 0 || from < 0 || to < 0) return null
    for (let day = from; ; day = (day + 1) % 7) {
      days.add(day)
      if (day === to) break
    }
  }
  return days
}

function parseRanges(text: string): [number, number][] | null {
  const ranges: [number, number][] = []
  for (const part of text.split(',')) {
    const [first, last, ...rest] = part.split('-')
    const from = minutes(first)
    const to = minutes(last)
    if (rest.length > 0 || from === null || to === null) return null
    ranges.push([from, to > from ? to : to + DAY_MINUTES])
  }
  return ranges
}

const EVERY_DAY = new Set([0, 1, 2, 3, 4, 5, 6])
const CLOSED = /^(off|closed)$/

function parseRule(text: string): Rule | null {
  const tokens = text.trim().split(/\s+/)
  const [first, second] = tokens
  if (!first || tokens.length > 2) return null
  if (second === undefined) {
    if (CLOSED.test(first)) return { days: EVERY_DAY, ranges: [] }
    const ranges = parseRanges(first)
    if (ranges) return { days: EVERY_DAY, ranges }
    const days = parseDays(first)
    return days ? { days, ranges: [[0, DAY_MINUTES]] } : null
  }
  const days = parseDays(first)
  const ranges = CLOSED.test(second) ? [] : parseRanges(second)
  return days && ranges ? { days, ranges } : null
}

const WARSAW = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Day of the week (0 = Monday) and minute of the day in Poland, whatever the clock of the machine says. */
function warsawTime(at: Date): { day: number; minute: number } {
  const parts = Object.fromEntries(WARSAW.formatToParts(at).map((part) => [part.type, part.value]))
  return { day: WEEKDAYS.indexOf(parts.weekday ?? ''), minute: Number(parts.hour) * 60 + Number(parts.minute) }
}

/** Whether the hours in `godziny_dostepnosci` cover the moment `at`. */
export function availabilityAt(hours: string | null | undefined, at: Date): Availability {
  const text = hours?.trim()
  if (!text) return 'unknown'
  if (text === '24/7') return 'open'
  const rules: Rule[] = []
  for (const part of text.split(';')) {
    if (part.trim() === '') continue
    const rule = parseRule(part)
    if (!rule) return 'unknown'
    rules.push(rule)
  }
  const { day, minute } = warsawTime(at)
  if (rules.length === 0 || day < 0) return 'unknown'

  /** The last rule that names a day decides that day. */
  const rangesOn = (weekday: number) => rules.findLast((rule) => rule.days.has(weekday))?.ranges ?? []
  const today = rangesOn(day).some(([from, to]) => from <= minute && minute < to)
  const sinceYesterday = rangesOn((day + 6) % 7).some(([, to]) => minute + DAY_MINUTES < to)
  return today || sinceYesterday ? 'open' : 'closed'
}

export type ReachableNow = 'yes' | 'no' | 'unknown'

/**
 * Can a passer-by get to this device right now? "no" when it is withdrawn, out of service, not open to people
 * from outside, or outside its hours; "unknown" when the record does not say when it can be reached.
 */
export function reachableNow(record: Pick<AedRecord, 'status' | 'dostep' | 'godziny_dostepnosci'>, at: Date): ReachableNow {
  if (record.status === 'wycofany' || record.status === 'czasowo_niedostepny' || record.dostep === 'prywatny') return 'no'
  const hours = availabilityAt(record.godziny_dostepnosci, at)
  return hours === 'open' ? 'yes' : hours === 'closed' ? 'no' : 'unknown'
}
