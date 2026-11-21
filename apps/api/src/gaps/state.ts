/**
 * What the gap endpoints answer from. Supply follows the dataset: a merge, a keeper's edit, an expired battery.
 * The national overview is computed in the background once per set of devices that count, so no request waits
 * for the whole country, and a change that moved no device does not start the count again.
 */
import { createHash } from 'node:crypto'
import { now, today } from '../config'
import type { Store } from '../db/store'
import { notWorking } from '../passport/service'
import type { Geo } from '../pipeline/geocode'
import { distanceM } from '../pipeline/normalize'
import { buildCoverage, hexesOfCell, hexState, nationalOverview, type Coverage, type HexState, type Overview, TotalsBuilder, type Totals } from './engine'
import { recommend, type Placement } from './greedy'
import { cellCentre, populationCells, type GridCell } from './population'
import { basisCounts, hasHour, MASK_WORDS, NIGHT_HOUR, supplyPoints, type HoursBasis, type SupplyPoint } from './supply'
import { cellToLatLng } from 'h3-js'
import { WEEK_HOURS } from '@aed/schema'
import { inArea, inShape, kmToEdge, type Area, type Bbox } from './area'

export interface Supply {
  /**
   * Names what the figures are counted from: where the devices that count are, and at which hours of the week.
   * A change that moves none of that (a new phone number, a merge that brought nothing new) leaves it as it was.
   */
  key: string
  points: SupplyPoint[]
  coverage: Coverage
  counts: Record<HoursBasis, number>
}

/** Position and hours of every device that counts, as one number: 40 bytes a device, in the order of the dataset. */
function coverageKey(points: readonly SupplyPoint[]): string {
  const counted = points.filter((point) => point.hoursPerWeek > 0)
  const bytes = Buffer.alloc(counted.length * (16 + MASK_WORDS * 4))
  let at = 0
  for (const point of counted) {
    at = bytes.writeDoubleLE(point.lat, at)
    at = bytes.writeDoubleLE(point.lon, at)
    for (const word of point.mask) at = bytes.writeUInt32LE(word, at)
  }
  return createHash('sha1').update(bytes).digest('hex').slice(0, 16)
}

let supplyCache: { store: Store; revision: number; broken: string; supply: Supply } | null = null
/**
 * Looked at again whenever a device changes (a merge, a keeper's edit) or stops (or starts again) counting as
 * working. The coverage, which takes the longest, is built again only when a device moved or its hours changed.
 */
export function supplyFor(store: Store): Supply {
  const notWorkingNow = notWorking(store, today(), now())
  const broken = [...notWorkingNow].sort().join(',')
  if (supplyCache?.store !== store || supplyCache.revision !== store.revision || supplyCache.broken !== broken) {
    const points = supplyPoints(store.aeds, notWorkingNow)
    const key = coverageKey(points)
    const coverage = supplyCache?.supply.key === key ? supplyCache.supply.coverage : buildCoverage(points)
    supplyCache = { store, revision: store.revision, broken, supply: { key, points, coverage, counts: basisCounts(points) } }
  }
  return supplyCache.supply
}

export type TimedOverview = Overview & { tookMs: number; computedAt: string }

let overviewCache: { key: string; promise: Promise<TimedOverview> } | null = null
/** The national overview for the current dataset; starts computing it on first call. */
export function overviewFor(store: Store): Promise<TimedOverview> {
  const supply = supplyFor(store)
  if (overviewCache?.key !== supply.key) {
    const started = Date.now()
    const promise = nationalOverview(populationCells(), supply.coverage).then((overview) => ({ ...overview, tookMs: Date.now() - started, computedAt: new Date().toISOString() }))
    const entry = { key: supply.key, promise }
    overviewCache = entry
    promise.catch((error) => {
      console.error('gaps: national overview failed', error)
      if (overviewCache === entry) overviewCache = null
    })
  }
  return overviewCache.promise
}

// ------------------------------------------------------------------------ view

/** Most populated squares one view may hold (the whole of Warsaw is about 500). */
export const MAX_CELLS = 1500

let centres: Float64Array | null = null
function cellCentres(cells: readonly GridCell[]): Float64Array {
  if (!centres || centres.length !== cells.length * 2) {
    centres = new Float64Array(cells.length * 2)
    cells.forEach((cell, i) => {
      const [lat, lon] = cellCentre(cell)
      centres![i * 2] = lat
      centres![i * 2 + 1] = lon
    })
  }
  return centres
}

export type { Bbox }

/** Populated squares that may have a hexagon centre inside the box. */
export function cellsIn(bbox: Bbox, cells: readonly GridCell[] = populationCells()): GridCell[] {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const at = cellCentres(cells)
  // Half the diagonal of a 1 km square, with room for its rotation in degrees.
  const dLat = 0.008
  const dLon = 0.012
  const found: GridCell[] = []
  for (let i = 0; i < cells.length; i++) {
    const lat = at[i * 2]!
    const lon = at[i * 2 + 1]!
    if (lat >= minLat - dLat && lat <= maxLat + dLat && lon >= minLon - dLon && lon <= maxLon + dLon) found.push(cells[i]!)
  }
  return found
}

/** A square can hold a hexagon centre at most this far from its own centre: half its diagonal and a little more. */
const CELL_REACH_KM = 0.75

/**
 * The hexagons of the squares whose centre lies in the area, and how many squares gave at least one.
 * For a shape, squares wholly outside it are skipped before they are split, which is most of a commune's box.
 */
export function hexesIn(area: Area, cells: readonly GridCell[], coverage: Coverage): { states: HexState[]; used: number } {
  const states: HexState[] = []
  let used = 0
  for (const cell of cells) {
    if (area.shape) {
      const [lat, lon] = cellCentre(cell)
      if (!inShape(area.shape, lon, lat) && kmToEdge(area.shape, lon, lat) > CELL_REACH_KM) continue
    }
    const before = states.length
    for (const demand of hexesOfCell(cell)) {
      const [lat, lon] = cellToLatLng(demand.hex)
      if (inArea(area, lon, lat)) states.push(hexState(demand, coverage))
    }
    if (states.length > before) used++
  }
  return { states: states.sort((a, b) => (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0)), used }
}

/** The small hexagons of the part of the map in view, for a close-up; nothing when the view holds too many squares. */
export function hexesNear(store: Store, bbox: Bbox): { tooLarge: boolean; hexes: HexState[] } {
  const cells = cellsIn(bbox)
  if (cells.length > MAX_CELLS) return { tooLarge: true, hexes: [] }
  return { tooLarge: false, hexes: hexesIn({ bbox, shape: null }, cells, supplyFor(store).coverage).states }
}

export interface NearbyDevice {
  id: string
  name: string
  distanceM: number
  hours: string | null
  basis: HoursBasis
  hoursPerWeek: number
  atNight: boolean
  publication: 'official' | 'community'
}

export interface PlaceReport extends Placement {
  /** Devices within 600 m of the spot, nearest first (also those that count for nothing: private ones). */
  nearby: NearbyDevice[]
  /** The nearest device that can be reached at every hour of the week. */
  nearestAllWeek: { id: string; name: string; distanceM: number } | null
  commune: { terc: string; gmina: string; powiat: string; wojewodztwo: string } | null
  address: string | null
}

const NEARBY_M = 600

function nearbyOf(points: readonly SupplyPoint[], lat: number, lon: number): Pick<PlaceReport, 'nearby' | 'nearestAllWeek'> {
  const nearby: NearbyDevice[] = []
  let nearestAllWeek: PlaceReport['nearestAllWeek'] = null
  for (const point of points) {
    // Cheap box first (0.01° is at least 690 m in Poland); devices open all week are measured anyway.
    const far = Math.abs(point.lat - lat) > 0.01 || Math.abs(point.lon - lon) > 0.015
    if (far && point.hoursPerWeek < WEEK_HOURS) continue
    const distance = Math.round(distanceM(lat, lon, point.lat, point.lon))
    if (distance <= NEARBY_M) {
      nearby.push({ id: point.id, name: point.name, distanceM: distance, hours: point.hours, basis: point.basis, hoursPerWeek: point.hoursPerWeek, atNight: hasHour(point.mask, NIGHT_HOUR), publication: point.publication })
    }
    if (point.hoursPerWeek === WEEK_HOURS && (nearestAllWeek === null || distance < nearestAllWeek.distanceM)) nearestAllWeek = { id: point.id, name: point.name, distanceM: distance }
  }
  nearby.sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id))
  return { nearby: nearby.slice(0, 10), nearestAllWeek }
}

/** A register answer within `ms`, or null: the report must not hang on a slow register. */
async function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<null>((done) => (timer = setTimeout(() => done(null), ms)))
  try {
    return await Promise.race([work.catch(() => null), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export interface ViewResult {
  tooLarge: boolean
  /** Populated squares of the area, as counted against MAX_CELLS. */
  cells: number
  totals: Totals
  hexes: HexState[]
  places: PlaceReport[]
}

/**
 * A box may hold MAX_CELLS populated squares. A shape is measured by the squares inside it, since the box around a
 * commune can be far bigger than the commune; only a box many times too large is refused before counting.
 */
export async function analyseView(store: Store, geo: Geo, area: Area, count: number): Promise<ViewResult> {
  const supply = supplyFor(store)
  const cells = cellsIn(area.bbox)
  const empty = new TotalsBuilder().result()
  const tooLarge = (counted: number): ViewResult => ({ tooLarge: true, cells: counted, totals: empty, hexes: [], places: [] })
  if (cells.length > (area.shape ? 4 * MAX_CELLS : MAX_CELLS)) return tooLarge(cells.length)
  const { states: hexes, used } = hexesIn(area, cells, supply.coverage)
  if (used > MAX_CELLS) return tooLarge(used)
  const totals = new TotalsBuilder()
  for (const state of hexes) totals.add(state)
  const picks = recommend(hexes, count)
  const places = await Promise.all(
    picks.map(async (pick) => {
      const [commune, address] = await Promise.all([within(3000, geo.commune(pick.lat, pick.lon)), within(3000, geo.nearestAddress(pick.lat, pick.lon))])
      return {
        ...pick,
        ...nearbyOf(supply.points, pick.lat, pick.lon),
        commune: commune ? { terc: commune.terc, gmina: commune.gmina, powiat: commune.powiat, wojewodztwo: commune.wojewodztwo } : null,
        address: address ? [address.street, address.number].filter(Boolean).join(' ') + (address.city ? `, ${address.city}` : '') : null,
      }
    }),
  )
  return { tooLarge: false, cells: area.shape ? used : cells.length, totals: totals.result(), hexes, places }
}
