/**
 * Reads `godziny_dostepnosci` (the subset of OpenStreetMap's `opening_hours` syntax that the pattern uses) and
 * answers one question: can the device be reached at a given moment?
 *
 * Understood: `24/7`, weekday lists and ranges, public holidays (`PH`, Polish calendar), time ranges (also past
 * midnight), `off`, rules separated by `;` where a later rule replaces an earlier one for the days it names.
 * Anything else (school holidays, months, sunrise, comments) gives "unknown": a wrong "open" would send a rescuer
 * to a locked door.
 */
import type { AedRecord } from './fields'
import { isPolishHoliday } from './holidays'

export type Availability = 'open' | 'closed' | 'unknown'

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const DAY_MINUTES = 24 * 60

interface Rule {
  days: Set<number>
  /** The rule names public holidays (`PH`): on a holiday it applies whatever the day of the week. */
  holiday: boolean
  /** Minutes from midnight; an end beyond 1440 runs into the next day. */
  ranges: [number, number][]
}

function minutes(text: string | undefined): number | null {
  const match = text?.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const value = Number(match[1]) * 60 + Number(match[2])
  return Number(match[2]) < 60 && value <= DAY_MINUTES ? value : null
}

function parseDays(text: string): { days: Set<number>; holiday: boolean } | null {
  const days = new Set<number>()
  let holiday = false
  for (const part of text.split(',')) {
    if (part === 'PH') {
      holiday = true
      continue
    }
    const [first, last, ...rest] = part.split('-')
    const from = DAYS.indexOf(first ?? '')
    const to = last === undefined ? from : DAYS.indexOf(last)
    if (rest.length > 0 || from < 0 || to < 0) return null
    for (let day = from; ; day = (day + 1) % 7) {
      days.add(day)
      if (day === to) break
    }
  }
  return { days, holiday }
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
    if (CLOSED.test(first)) return { days: EVERY_DAY, holiday: true, ranges: [] }
    const ranges = parseRanges(first)
    if (ranges) return { days: EVERY_DAY, holiday: true, ranges }
    const days = parseDays(first)
    return days ? { ...days, ranges: [[0, DAY_MINUTES]] } : null
  }
  const days = parseDays(first)
  const ranges = CLOSED.test(second) ? [] : parseRanges(second)
  return days && ranges ? { ...days, ranges } : null
}

const WARSAW = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface WarsawTime {
  readonly day: number
  readonly minute: number
  readonly date: string
}

/** A list of devices is checked against one moment, and formatting a date in a time zone is slow: keep the last answer. */
let lastTime: { ms: number; time: WarsawTime } | null = null

/** Day of the week (0 = Monday), minute of the day and date (YYYY-MM-DD) in Poland, whatever the machine's clock says. */
export function warsawTime(at: Date): WarsawTime {
  const ms = at.getTime()
  if (lastTime?.ms === ms) return lastTime.time
  const parts = Object.fromEntries(WARSAW.formatToParts(at).map((part) => [part.type, part.value]))
  const time = { day: WEEKDAYS.indexOf(parts.weekday ?? ''), minute: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` }
  lastTime = { ms, time }
  return time
}

/** The calendar day `days` after YYYY-MM-DD. */
const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** The same few hundred values come back in every list ("Mo-Fr 08:00-16:00"); each is read once. */
const RULES_KEPT = 5000
const rulesByText = new Map<string, Rule[] | null>()

/** The rules of a value as it stands (public holidays included), or null when any part of it is not understood. */
function rulesOf(text: string): Rule[] | null {
  let rules = rulesByText.get(text)
  if (rules === undefined) {
    rules = parseRules(text)
    // Hours are free text from many sources; do not let odd values pile up for ever.
    if (rulesByText.size >= RULES_KEPT) rulesByText.clear()
    rulesByText.set(text, rules)
  }
  return rules
}

/** All rules of a value, or null when any part of it is not understood. */
function parseRules(text: string, prepare: (part: string) => string | null = (part) => part): Rule[] | null {
  const rules: Rule[] = []
  for (const raw of text.split(';')) {
    if (raw.trim() === '') continue
    const part = prepare(raw)
    if (part === null) continue
    const rule = parseRule(part)
    if (!rule) return null
    rules.push(rule)
  }
  // Rules about holidays alone say nothing about an ordinary day.
  return rules.some((rule) => rule.days.size > 0) ? rules : null
}

/**
 * Whether the rules open the device on `day` (0 = Monday) at `minute` past midnight. `holiday` tells whether
 * that day and the day before are public holidays; an ordinary week has none.
 */
function openAt(rules: Rule[], day: number, minute: number, holiday: { today: boolean; yesterday: boolean } = { today: false, yesterday: false }): boolean {
  return openIn(rangesOn(rules, day, holiday.today), rangesOn(rules, (day + 6) % 7, holiday.yesterday), minute)
}

const NO_RANGES: [number, number][] = []

/** The last rule that names a day (or, on a holiday, names holidays) decides that day. */
const rangesOn = (rules: Rule[], weekday: number, isHoliday: boolean) => rules.findLast((rule) => rule.days.has(weekday) || (isHoliday && rule.holiday))?.ranges ?? NO_RANGES

/** Open at `minute` by the ranges of that day, or by one of the day before that runs past midnight. */
const openIn = (today: [number, number][], yesterday: [number, number][], minute: number) =>
  today.some(([from, to]) => from <= minute && minute < to) || yesterday.some(([, to]) => minute + DAY_MINUTES < to)

let lastHolidays: { date: string; around: { today: boolean; yesterday: boolean } } | null = null

/** Whether a day and the day before it are public holidays; the last day asked about is kept, like the last moment. */
function holidaysAround(date: string): { today: boolean; yesterday: boolean } {
  if (lastHolidays?.date !== date) lastHolidays = { date, around: { today: isPolishHoliday(date), yesterday: isPolishHoliday(plusDays(date, -1)) } }
  return lastHolidays.around
}

/** Whether the hours in `godziny_dostepnosci` cover the moment `at`. */
export function availabilityAt(hours: string | null | undefined, at: Date): Availability {
  const text = hours?.trim()
  if (!text) return 'unknown'
  if (text === '24/7') return 'open'
  const rules = rulesOf(text)
  const { day, minute, date } = warsawTime(at)
  if (!rules || day < 0) return 'unknown'
  return openAt(rules, day, minute, holidaysAround(date)) ? 'open' : 'closed'
}

export interface HoursChange {
  /** Whether the device can be reached now. */
  open: boolean
  /** Minutes until that changes. */
  minutes: number
  /** Local time of the change, "18:00". */
  time: string
  /** 0 = today, 1 = tomorrow … (Warsaw calendar). */
  days: number
}

const STEP = 5

/**
 * When the device next opens or closes, looked up to a week ahead in steps of 5 minutes (hours in the data are
 * whole quarters). Null when the hours are not understood or nothing changes within the week ("24/7").
 * Local time is advanced as if every day had 24 hours; on the night of a clock change the answer may be an hour off.
 */
export function nextChange(hours: string | null | undefined, at: Date): HoursChange | null {
  const text = hours?.trim()
  if (!text || text === '24/7') return null
  const rules = rulesOf(text)
  const start = warsawTime(at)
  if (!rules || start.day < 0) return null
  const openNow = openAt(rules, start.day, start.minute, holidaysAround(start.date))
  // Which ranges apply changes only at midnight: look them up once a day, not at every step.
  let day = -1
  let today = NO_RANGES
  let yesterday = NO_RANGES
  let elapsed = STEP - (start.minute % STEP)
  for (; elapsed <= 7 * DAY_MINUTES; elapsed += STEP) {
    const total = start.minute + elapsed
    const days = Math.floor(total / DAY_MINUTES)
    const minute = total % DAY_MINUTES
    if (days !== day) {
      day = days
      const weekday = (start.day + days) % 7
      const holiday = holidaysAround(plusDays(start.date, days))
      today = rangesOn(rules, weekday, holiday.today)
      yesterday = rangesOn(rules, (weekday + 6) % 7, holiday.yesterday)
    }
    if (openIn(today, yesterday, minute) !== openNow) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
      return { open: openNow, minutes: elapsed, time, days }
    }
  }
  return null
}

export const WEEK_HOURS = 168

/**
 * Drops public and school holidays from a rule ("Sa-Su, PH off" → "Sa-Su off"): an ordinary week has none, so they
 * do not change how many hours of it a device can be reached. A rule about holidays only disappears.
 */
function withoutHolidays(part: string): string | null {
  const tokens = part.trim().replace(/\s*,\s*/g, ',').split(/\s+/)
  const days = tokens[0]?.split(',').filter((day) => day !== 'PH' && day !== 'SH')
  if (!days || days.length === 0) return null
  return [days.join(','), ...tokens.slice(1)].join(' ')
}

/**
 * For each of the 168 hours of an ordinary week (index 0 = Monday 00:00–01:00, Warsaw time), whether the hours
 * open the device in the middle of that hour. Null when the value is missing or not understood.
 * Used to measure how much of the week a device really covers, not to tell anyone a door is open now.
 */
export function weeklyHours(hours: string | null | undefined): boolean[] | null {
  const text = hours?.trim()
  if (!text) return null
  if (text === '24/7') return Array.from({ length: WEEK_HOURS }, () => true)
  const rules = parseRules(text, withoutHolidays)
  if (!rules) return null
  return Array.from({ length: WEEK_HOURS }, (_, hour) => openAt(rules, Math.floor(hour / 24), (hour % 24) * 60 + 30))
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
