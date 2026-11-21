/**
 * The gap engine: residents in H3 hexagons against the hours of the week a defibrillator is within reach.
 * Deterministic and explainable on purpose: every number can be traced to a census square and a device.
 */
import { cellToBoundary, cellToLatLng, cellToParent, gridDisk, latLngToCell, polygonToCells } from 'h3-js'
import { WEEK_HOURS } from '@aed/schema'
import { distanceM } from '../pipeline/normalize'
import { cellCentre, cellCorners, type GridCell } from './population'
import { countHours, emptyMask, hasHour, NIGHT_HOUR, orInto, type SupplyPoint, type WeekMask } from './supply'

/** H3 resolution of the analysis: hexagons of about 0.1 km², centres about 350 m apart. */
export const RES = 9
/** Resolution of the national overview: hexagons of about 36 km². */
export const OVERVIEW_RES = 6
/** A device counts for a hexagon when it is at most this far from the hexagon's centre (run there and back in ~5 min). */
export const REACH_M = 400
/** A resident aged 65+ counts this many times: most cardiac arrests happen in that group. */
export const SENIOR_WEIGHT = 3

/** For every hexagon with a device in reach: the hours of the week at least one of them can be reached. */
export type Coverage = Map<string, WeekMask>

export function buildCoverage(points: readonly SupplyPoint[]): Coverage {
  const coverage: Coverage = new Map()
  for (const point of points) {
    if (point.hoursPerWeek === 0) continue
    for (const hex of gridDisk(latLngToCell(point.lat, point.lon, RES), 2)) {
      const [lat, lon] = cellToLatLng(hex)
      if (distanceM(point.lat, point.lon, lat, lon) > REACH_M) continue
      let mask = coverage.get(hex)
      if (!mask) coverage.set(hex, (mask = emptyMask()))
      orInto(mask, point.mask)
    }
  }
  return coverage
}

export interface HexDemand {
  hex: string
  residents: number
  seniors: number
}

/**
 * Splits each square evenly among the hexagons whose centre lies in it, so the sum of residents is kept.
 * A square too small to hold a centre (never at resolution 9 and 1 km) gives everything to the hexagon of its centre.
 */
export function hexesOfCell(cell: GridCell): HexDemand[] {
  let hexes = polygonToCells(cellCorners(cell), RES)
  if (hexes.length === 0) hexes = [latLngToCell(...cellCentre(cell), RES)]
  return hexes.map((hex) => ({ hex, residents: cell.residents / hexes.length, seniors: cell.seniors / hexes.length }))
}

export interface HexState extends HexDemand {
  /** Hours of the week a device in reach can be reached (0–168). */
  coveredHours: number
  /** No known device in reach at all, whatever its hours. */
  noDevice: boolean
  /** No device in reach on Sunday at 3:00. */
  noNight: boolean
  /** Weighted residents × hours of the week without a device; integer, so sums do not depend on their order. */
  deficit: number
}

export const weight = (demand: Pick<HexDemand, 'residents' | 'seniors'>) => demand.residents + (SENIOR_WEIGHT - 1) * demand.seniors

export function hexState(demand: HexDemand, coverage: Coverage): HexState {
  const mask = coverage.get(demand.hex)
  const coveredHours = mask ? countHours(mask) : 0
  return {
    ...demand,
    coveredHours,
    noDevice: !mask,
    noNight: !mask || !hasHour(mask, NIGHT_HOUR),
    deficit: Math.round(weight(demand) * (WEEK_HOURS - coveredHours)),
  }
}

export interface Totals {
  residents: number
  seniors: number
  /** Residents with no known device within REACH_M. */
  noDevice: number
  /** Residents with no device they can reach on Sunday at 3:00. */
  noNight: number
  /** Share of resident-hours of the week with a device in reach (0–1). */
  coveredShare: number
}

export class TotalsBuilder {
  residents = 0
  seniors = 0
  noDevice = 0
  noNight = 0
  coveredResidentHours = 0

  add(state: HexState): void {
    this.residents += state.residents
    this.seniors += state.seniors
    if (state.noDevice) this.noDevice += state.residents
    if (state.noNight) this.noNight += state.residents
    this.coveredResidentHours += state.residents * state.coveredHours
  }

  result(): Totals {
    return {
      residents: Math.round(this.residents),
      seniors: Math.round(this.seniors),
      noDevice: Math.round(this.noDevice),
      noNight: Math.round(this.noNight),
      coveredShare: this.residents > 0 ? Math.round((this.coveredResidentHours / (this.residents * WEEK_HOURS)) * 1000) / 1000 : 0,
    }
  }
}

export interface Overview {
  totals: Totals
  /** Per hexagon of OVERVIEW_RES. */
  areas: Map<string, TotalsBuilder>
}

/**
 * The country takes most of a minute to count, and a request that comes in meanwhile waits until this lets go.
 * So it lets go this often: a list of devices or a map layer is then held up by a blink, not by a quarter of a second.
 */
const SLICE_MS = 8

/** The whole country, summed straight into large hexagons; yields to other requests every few milliseconds. */
export async function nationalOverview(cells: readonly GridCell[], coverage: Coverage): Promise<Overview> {
  const total = new TotalsBuilder()
  const areas = new Map<string, TotalsBuilder>()
  let sliceEnd = performance.now() + SLICE_MS
  for (const cell of cells) {
    for (const demand of hexesOfCell(cell)) {
      const state = hexState(demand, coverage)
      total.add(state)
      const parent = cellToParent(demand.hex, OVERVIEW_RES)
      let area = areas.get(parent)
      if (!area) areas.set(parent, (area = new TotalsBuilder()))
      area.add(state)
    }
    if (performance.now() >= sliceEnd) {
      await new Promise((done) => setImmediate(done))
      sliceEnd = performance.now() + SLICE_MS
    }
  }
  return { totals: total.result(), areas }
}

/** Closed ring of [lon, lat] pairs with 6 decimals (about 10 cm), for GeoJSON. */
export function hexPolygon(hex: string): [number, number][][] {
  return [cellToBoundary(hex, true).map(([lon, lat]) => [Math.round(lon! * 1e6) / 1e6, Math.round(lat! * 1e6) / 1e6] as [number, number])]
}
