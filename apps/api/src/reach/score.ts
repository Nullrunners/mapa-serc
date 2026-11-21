/**
 * "Dostępny TERAZ": orders devices by how soon a rescuer can have one in hand at this minute, not by straight-line
 * distance. A device 250 m away on a wall, open round the clock, beats one 50 m away in an office that closed at 18:00.
 *
 * Expected time = walk there (straight line × 1.3 for streets, at 2 m/s) + time lost on the spot (cabinet code,
 * reception, floors) + a penalty for not knowing whether the door is open. Every part is listed in `reasons`,
 * so the order can be explained to the person reading it.
 */
import { availabilityAt, nextChange, type AccessMethod, type AedRecord, type HoursChange } from '@aed/schema'

export type ReachState = 'open' | 'likely_open' | 'unknown' | 'closed'

export type ReachReason =
  | 'hours_24_7'
  | 'hours_open'
  | 'hours_closed'
  | 'outdoor_no_hours'
  | 'no_hours'
  | 'staff_only'
  | 'out_of_service'
  | 'method_free'
  | 'method_alarm'
  | 'method_code'
  | 'method_staff'
  | 'outdoor'
  | 'floor'
  | 'reported_problem'

export interface Reach {
  state: ReachState
  /** Seconds until the device is in hand; null for a device that cannot be reached now. */
  etaS: number | null
  walkS: number
  /** Seconds lost on the spot: cabinet, staff, floors. */
  accessS: number
  method: AccessMethod | null
  /** The method was read from the description, not given by the source. */
  methodGuessed: boolean
  /** When the hours next change; null for 24/7, unknown hours, or no change within a week. */
  change: HoursChange | null
  reasons: ReachReason[]
  /** Sort key in seconds; lower is better. */
  score: number
}

const WALK_SPEED = 2
const STREET_FACTOR = 1.3

const METHOD_SECONDS: Record<AccessMethod, number> = { swobodny: 0, szafka_z_alarmem: 10, szafka_z_kodem: 60, przez_obsluge: 90 }
const METHOD_REASON: Record<AccessMethod, ReachReason> = { swobodny: 'method_free', szafka_z_alarmem: 'method_alarm', szafka_z_kodem: 'method_code', przez_obsluge: 'method_staff' }

/** Seconds added when we do not know whether the device can be reached; a known open door is worth that much. */
const STATE_PENALTY: Record<Exclude<ReachState, 'closed'>, number> = { open: 0, likely_open: 45, unknown: 120 }
const PROBLEM_PENALTY = 240
const PER_FLOOR = 20
/** Somewhere inside a building nobody described: time to find it. */
const UNDESCRIBED_INDOORS = 30

const plain = (text: string) =>
  text
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * Only phrases that leave no doubt: "w portierni" means the porter hands it over, "przy portierni" does not.
 * A guess that is too pessimistic costs a minute in the order; one too optimistic sends someone to a locked cabinet.
 */
const GUESSES: [RegExp, AccessMethod][] = [
  [/\b(kod\w*|pin\w*|szyfr\w*) (do|od|na) szaf|\bszafk\w* (z|na) (kod|pin|szyfr)|\bkod (podaje|poda|udostepnia)/, 'szafka_z_kodem'],
  [/\b(w|na) (recepcji|portierni|dyzurce|sekretariacie)\b|\b(u|w pomieszczeniu|w pokoju|w pokoju) (ochrony|portiera|recepcji)|\bklucz\w*|\bwydaje\b/, 'przez_obsluge'],
  [/\bszafk\w* z alarmem|\balarm\w* (po|przy) otwarciu/, 'szafka_z_alarmem'],
]

export function accessMethod(record: Pick<AedRecord, 'sposob_dostepu' | 'uwagi_dostepu' | 'opis_lokalizacji' | 'wewnatrz_budynku'>): { method: AccessMethod | null; guessed: boolean } {
  if (record.sposob_dostepu) return { method: record.sposob_dostepu, guessed: false }
  const text = plain([record.uwagi_dostepu, record.opis_lokalizacji].filter(Boolean).join(' '))
  const found = GUESSES.find(([pattern]) => pattern.test(text))
  return { method: found?.[1] ?? null, guessed: found !== undefined }
}

/** "1", "-1", "I piętro", "parter" → floors away from the ground; null when the value says nothing clear. */
export function floorsAway(level: string | null): number | null {
  if (!level) return null
  const text = plain(level).trim()
  if (/^parter|^0$/.test(text)) return 0
  const number = /^-?\d+/.exec(text)
  if (number) return Math.abs(Number(number[0]))
  const roman = /^(i{1,3}|iv|v)\b/.exec(text)
  return roman ? { i: 1, ii: 2, iii: 3, iv: 4, v: 5 }[roman[1] as 'i' | 'ii' | 'iii' | 'iv' | 'v'] : null
}

export type ReachRecord = Pick<
  AedRecord,
  'status' | 'dostep' | 'godziny_dostepnosci' | 'wewnatrz_budynku' | 'pietro' | 'sposob_dostepu' | 'uwagi_dostepu' | 'opis_lokalizacji'
>

/**
 * Everything about one device at one moment. `withChange` also looks up when the hours next change, which takes
 * longer: worth it for the devices shown, not for every device that is sorted.
 */
export function reach(record: ReachRecord, distanceM: number, at: Date, options: { problem?: boolean; withChange?: boolean } = {}): Reach {
  const reasons: ReachReason[] = []
  const walkS = Math.round((distanceM * STREET_FACTOR) / WALK_SPEED)

  let state: ReachState
  if (record.status === 'wycofany' || record.status === 'czasowo_niedostepny') {
    state = 'closed'
    reasons.push('out_of_service')
  } else if (record.dostep === 'prywatny') {
    state = 'closed'
    reasons.push('staff_only')
  } else {
    const hours = availabilityAt(record.godziny_dostepnosci, at)
    if (hours === 'open') {
      state = 'open'
      reasons.push(record.godziny_dostepnosci?.trim() === '24/7' ? 'hours_24_7' : 'hours_open')
    } else if (hours === 'closed') {
      state = 'closed'
      reasons.push('hours_closed')
    } else if (record.wewnatrz_budynku === false) {
      // An outdoor cabinet is almost always reachable round the clock; still, nobody wrote it down.
      state = 'likely_open'
      reasons.push('outdoor_no_hours')
    } else {
      state = 'unknown'
      reasons.push('no_hours')
    }
  }

  const { method, guessed } = accessMethod(record)
  let accessS = 0
  if (method) {
    accessS += METHOD_SECONDS[method]
    reasons.push(METHOD_REASON[method])
  } else if (record.wewnatrz_budynku === false) {
    reasons.push('outdoor')
  } else if (!record.opis_lokalizacji) {
    accessS += UNDESCRIBED_INDOORS
  }
  const floors = record.wewnatrz_budynku === false ? 0 : (floorsAway(record.pietro) ?? 0)
  if (floors > 0) {
    accessS += floors * PER_FLOOR
    reasons.push('floor')
  }
  if (options.problem) reasons.push('reported_problem')

  const etaS = state === 'closed' ? null : walkS + accessS
  // Closed devices go last, nearest first, so the list still says what is there.
  const score = etaS === null ? 1_000_000 + walkS : etaS + STATE_PENALTY[state as Exclude<ReachState, 'closed'>] + (options.problem ? PROBLEM_PENALTY : 0)
  const change = options.withChange && state !== 'likely_open' && state !== 'unknown' ? nextChange(record.godziny_dostepnosci, at) : null

  return { state, etaS, walkS, accessS, method, methodGuessed: guessed, change, reasons, score }
}
