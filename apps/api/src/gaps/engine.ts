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
  /** The country at each of LEVELS, the coarser the further out the map is. */
  levels: Map<number, Level>
}

/**
 * Coarser resolutions summed for the whole country in the same pass, from about 250 km² down to 0.7 km². The map
 * shows the one that suits its zoom: the hexagons get smaller as it comes closer, until those of the analysis (RES).
 */
export const LEVELS = [5, 6, 7, 8] as const
const FINEST = LEVELS.at(-1)!

/**
 * One resolution of the whole country: its hexagons and their sums in flat arrays, index by index. Resolution 8 has
 * some 360 000 populated hexagons; as objects they would take several times the memory.
 */
export interface Level {
  res: number
  hexes: string[]
  /** Centres, to find the hexagons of a part of the map. */
  lat: Float64Array
  lon: Float64Array
  residents: Float64Array
  noDevice: Float64Array
  noNight: Float64Array
  /** Residents × hours of the week with a device in reach. */
  coveredHours: Float64Array
}

/** The figures of one hexagon of a level, rounded as the national ones are. */
export function levelFigures(level: Level, i: number) {
  const residents = level.residents[i]!
  const coveredHours = level.coveredHours[i]!
  return {
    residents: Math.round(residents),
    noDevice: Math.round(level.noDevice[i]!),
    noNight: Math.round(level.noNight[i]!),
    coveredShare: residents > 0 ? Math.round((coveredHours / (residents * WEEK_HOURS)) * 1000) / 1000 : 0,
    /** Residents × share of the week without a device in reach, the measure the map is coloured by. */
    uncovered: Math.round(residents - coveredHours / WEEK_HOURS),
  }
}

/** Indexes of the hexagons of a level whose centre lies in the box; a centre on its east or north edge belongs to the next box. */
export function levelIn(level: Level, [minLon, minLat, maxLon, maxLat]: readonly [number, number, number, number]): number[] {
  const found: number[] = []
  const { lat, lon } = level
  for (let i = 0; i < lat.length; i++) {
    const y = lat[i]!
    const x = lon[i]!
    if (x >= minLon && x < maxLon && y >= minLat && y < maxLat) found.push(i)
  }
  return found
}

/**
 * The country takes most of a minute to count, and a request that comes in meanwhile waits until this lets go.
 * So it lets go this often: a request is then noticed within a blink, not after a quarter of a second.
 */
const SLICE_MS = 4

/**
 * Lets the server answer every few milliseconds, and while `answering` says a request is being answered, at every
 * `breathe()`: an answer takes many small steps (read the request, look things up, send the pieces), and each of
 * them would otherwise wait for a whole slice.
 */
function breather(answering: () => boolean) {
  let sliceEnd = performance.now() + SLICE_MS
  return async () => {
    if (answering() || performance.now() >= sliceEnd) {
      await new Promise((done) => setImmediate(done))
      sliceEnd = performance.now() + SLICE_MS
    }
  }
}

/** Packs the sums of one level into flat arrays, a slice at a time. */
async function packLevel(res: number, size: number, sums: Iterable<[string, TotalsBuilder]>, breathe: () => Promise<void>): Promise<Level> {
  const level: Level = {
    res,
    hexes: new Array<string>(size),
    lat: new Float64Array(size),
    lon: new Float64Array(size),
    residents: new Float64Array(size),
    noDevice: new Float64Array(size),
    noNight: new Float64Array(size),
    coveredHours: new Float64Array(size),
  }
  let i = 0
  for (const [hex, sum] of sums) {
    const [lat, lon] = cellToLatLng(hex)
    level.hexes[i] = hex
    level.lat[i] = lat!
    level.lon[i] = lon!
    level.residents[i] = sum.residents
    level.noDevice[i] = sum.noDevice
    level.noNight[i] = sum.noNight
    level.coveredHours[i] = sum.coveredResidentHours
    i++
    if ((i & 1023) === 0) await breathe()
  }
  return level
}

/**
 * The whole country, summed straight into the hexagons of every level. The order of the hexagons follows the order of
 * the squares only, so the same data gives the same layers. Each hexagon of the analysis looks up its parent of the
 * finest level once; the coarser parents are looked up once per parent, not once per child.
 */
export async function nationalOverview(cells: readonly GridCell[], coverage: Coverage, answering: () => boolean = () => false): Promise<Overview> {
  const breathe = breather(answering)
  const total = new TotalsBuilder()
  const coarser = LEVELS.slice(0, -1).map(() => new Map<string, TotalsBuilder>())
  /** Per hexagon of the finest level: its sums at every level, from the coarsest. */
  const chains = new Map<string, TotalsBuilder[]>()
  for (const cell of cells) {
    for (const demand of hexesOfCell(cell)) {
      const state = hexState(demand, coverage)
      total.add(state)
      const finest = cellToParent(demand.hex, FINEST)
      let chain = chains.get(finest)
      if (!chain) {
        chain = coarser.map((sums, i) => {
          const parent = cellToParent(finest, LEVELS[i]!)
          let sum = sums.get(parent)
          if (!sum) sums.set(parent, (sum = new TotalsBuilder()))
          return sum
        })
        chain.push(new TotalsBuilder())
        chains.set(finest, chain)
      }
      for (const sum of chain) sum.add(state)
    }
    await breathe()
  }
  const levels = new Map<number, Level>()
  for (const [i, sums] of coarser.entries()) levels.set(LEVELS[i]!, await packLevel(LEVELS[i]!, sums.size, sums, breathe))
  const finest = (function* () {
    for (const [hex, chain] of chains) yield [hex, chain.at(-1)!] as [string, TotalsBuilder]
  })()
  levels.set(FINEST, await packLevel(FINEST, chains.size, finest, breathe))
  return { totals: total.result(), levels }
}

/** Closed ring of [lon, lat] pairs with 6 decimals (about 10 cm), for GeoJSON. */
export function hexPolygon(hex: string): [number, number][][] {
  return [cellToBoundary(hex, true).map(([lon, lat]) => [Math.round(lon! * 1e6) / 1e6, Math.round(lat! * 1e6) / 1e6] as [number, number])]
}
