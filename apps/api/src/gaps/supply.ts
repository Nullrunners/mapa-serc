/**
 * Supply side of the gap analysis: every known device with the hours of an ordinary week it can really be reached.
 * A defibrillator locked in an office after 15:30 helps nobody at night, so it counts only for its opening hours.
 */
import { WEEK_HOURS, weeklyHours } from '@aed/schema'
import type { MergedAed } from '../pipeline/merge'

/** Where the hours of a device come from. */
export type HoursBasis = 'hours' | 'outdoor' | 'assumed' | 'excluded'

/** 168 bits, one per hour of the week (bit `h` of word `h >> 5`). */
export type WeekMask = Uint32Array
export const MASK_WORDS = Math.ceil(WEEK_HOURS / 32)
/** Sunday 03:00–04:00: the hour the "at night" figures are about. */
export const NIGHT_HOUR = 6 * 24 + 3
/** Assumed when a device indoors gives no hours: Monday to Friday 8:00–16:00. */
export const ASSUMED_HOURS = 'Mo-Fr 08:00-16:00'

export interface SupplyPoint {
  id: string
  lat: number
  lon: number
  name: string
  publication: 'official' | 'community'
  hours: string | null
  basis: HoursBasis
  mask: WeekMask
  hoursPerWeek: number
}

export const emptyMask = (): WeekMask => new Uint32Array(MASK_WORDS)

export function maskOf(open: boolean[]): WeekMask {
  const mask = emptyMask()
  open.forEach((isOpen, hour) => {
    if (isOpen) mask[hour >> 5]! |= 1 << (hour & 31)
  })
  return mask
}

export const FULL_WEEK = maskOf(Array.from({ length: WEEK_HOURS }, () => true))
const ASSUMED = maskOf(weeklyHours(ASSUMED_HOURS)!)

export function countHours(mask: WeekMask): number {
  let count = 0
  for (let word of mask) {
    while (word) {
      word &= word - 1
      count++
    }
  }
  return count
}

export const hasHour = (mask: WeekMask, hour: number): boolean => (mask[hour >> 5]! & (1 << (hour & 31))) !== 0

/** `into |= from`, in place. */
export function orInto(into: WeekMask, from: WeekMask): void {
  for (let i = 0; i < MASK_WORDS; i++) into[i]! |= from[i]!
}

const parsed = new Map<string, WeekMask | null>()
function hoursMask(hours: string): WeekMask | null {
  if (!parsed.has(hours)) {
    const open = weeklyHours(hours)
    parsed.set(hours, open ? maskOf(open) : null)
  }
  return parsed.get(hours)!
}

export function classify(record: Pick<MergedAed['record'], 'status' | 'dostep' | 'godziny_dostepnosci' | 'wewnatrz_budynku'>): { basis: HoursBasis; mask: WeekMask } {
  if (record.status === 'wycofany' || record.status === 'czasowo_niedostepny' || record.dostep === 'prywatny') return { basis: 'excluded', mask: emptyMask() }
  const fromHours = record.godziny_dostepnosci ? hoursMask(record.godziny_dostepnosci) : null
  if (fromHours) return { basis: 'hours', mask: fromHours }
  if (record.wewnatrz_budynku === false) return { basis: 'outdoor', mask: FULL_WEEK }
  return { basis: 'assumed', mask: ASSUMED }
}

/**
 * Official and OpenStreetMap devices with a position; pending and incomplete records are left out.
 * Devices in `notWorking` (expired electrodes or battery, reported missing) are kept but not counted.
 */
export function supplyPoints(aeds: readonly MergedAed[], notWorking: ReadonlySet<string> = new Set()): SupplyPoint[] {
  const points: SupplyPoint[] = []
  for (const aed of aeds) {
    if (aed.publication !== 'official' && aed.publication !== 'community') continue
    const lat = aed.record.szerokosc_geograficzna
    const lon = aed.record.dlugosc_geograficzna
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const { basis, mask } = notWorking.has(aed.id) ? { basis: 'excluded' as const, mask: emptyMask() } : classify(aed.record)
    points.push({
      id: aed.id,
      lat,
      lon,
      name: aed.record.nazwa,
      publication: aed.publication,
      hours: aed.record.godziny_dostepnosci ?? null,
      basis,
      mask,
      hoursPerWeek: countHours(mask),
    })
  }
  return points
}

export function basisCounts(points: readonly SupplyPoint[]): Record<HoursBasis, number> {
  const counts: Record<HoursBasis, number> = { hours: 0, outdoor: 0, assumed: 0, excluded: 0 }
  for (const point of points) counts[point.basis]++
  return counts
}
