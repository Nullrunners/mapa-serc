/**
 * What the gap endpoints answer from. Supply is rebuilt when the dataset changes (keyed by the pipeline run);
 * the national overview is computed once per dataset in the background, so no request waits for the whole country.
 */
import type { Store } from '../db/store'
import type { Geo } from '../pipeline/geocode'
import { distanceM } from '../pipeline/normalize'
import { buildCoverage, hexesOfCell, hexState, nationalOverview, type Coverage, type HexState, type Overview, TotalsBuilder, type Totals } from './engine'
import { recommend, type Placement } from './greedy'
import { cellCentre, populationCells, type GridCell } from './population'
import { basisCounts, hasHour, NIGHT_HOUR, supplyPoints, type HoursBasis, type SupplyPoint } from './supply'
import { cellToLatLng } from 'h3-js'
import { WEEK_HOURS } from '@aed/schema'

export interface Supply {
  key: string
  points: SupplyPoint[]
  coverage: Coverage
  counts: Record<HoursBasis, number>
}

let supplyCache: Supply | null = null
export function supplyFor(store: Store): Supply {
  const key = store.ranAt ?? 'none'
  if (supplyCache?.key !== key) {
    const points = supplyPoints(store.aeds)
    supplyCache = { key, points, coverage: buildCoverage(points), counts: basisCounts(points) }
  }
  return supplyCache
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

export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number]

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

export function hexesIn(bbox: Bbox, cells: readonly GridCell[], coverage: Coverage): HexState[] {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const states: HexState[] = []
  for (const cell of cells) {
    for (const demand of hexesOfCell(cell)) {
      const [lat, lon] = cellToLatLng(demand.hex)
      if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) states.push(hexState(demand, coverage))
    }
  }
  return states.sort((a, b) => (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0))
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
  cells: number
  totals: Totals
  hexes: HexState[]
  places: PlaceReport[]
}

export async function analyseView(store: Store, geo: Geo, bbox: Bbox, count: number): Promise<ViewResult> {
  const supply = supplyFor(store)
  const cells = cellsIn(bbox)
  const empty = new TotalsBuilder().result()
  if (cells.length > MAX_CELLS) return { tooLarge: true, cells: cells.length, totals: empty, hexes: [], places: [] }
  const hexes = hexesIn(bbox, cells, supply.coverage)
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
  return { tooLarge: false, cells: cells.length, totals: totals.result(), hexes, places }
}
