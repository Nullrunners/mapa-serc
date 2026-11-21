/**
 * Where to put new defibrillators: greedy maximal covering (MCLP). Each step places one device available around the
 * clock where it removes the most deficit (weighted residents × hours of the week without a device in reach),
 * then counts those residents as covered and repeats. Greedy is within 63% of the best possible set and,
 * unlike a solver, every pick can be explained in one sentence. Ties go to the smaller hexagon id, so the same
 * data always gives the same list.
 */
import { cellToLatLng, gridDisk } from 'h3-js'
import { distanceM } from '../pipeline/normalize'
import { REACH_M, type HexState } from './engine'

export interface Placement {
  rank: number
  hex: string
  lat: number
  lon: number
  /** Hexagons whose residents the new device would serve. */
  reach: string[]
  /** Deficit removed by this pick (after the earlier picks). */
  gain: number
  /** Residents in reach who gain round-the-clock access by this pick (not counted again by later picks). */
  gained: { residents: number; seniors: number; noDevice: number; noNight: number }
  /** All residents in reach, whatever the earlier picks did. */
  inReach: { residents: number; seniors: number }
  /** Hours of the week a device is in reach of the chosen hexagon today. */
  coveredHoursNow: number
}

/** Hexagons within REACH_M of a hexagon's centre, including itself. */
export function reachOf(hex: string): string[] {
  const [lat, lon] = cellToLatLng(hex)
  return gridDisk(hex, 2)
    .filter((other) => {
      const [olat, olon] = cellToLatLng(other)
      return distanceM(lat, lon, olat, olon) <= REACH_M
    })
    .sort()
}

export function recommend(hexes: readonly HexState[], count: number): Placement[] {
  const byHex = new Map(hexes.map((state) => [state.hex, state]))
  const deficit = new Map(hexes.map((state) => [state.hex, state.deficit]))
  const candidates = [...byHex.keys()].sort()
  const reach = new Map(candidates.map((hex) => [hex, reachOf(hex).filter((other) => byHex.has(other))]))
  const picks: Placement[] = []

  for (let rank = 1; rank <= count; rank++) {
    let best: string | null = null
    let bestGain = 0
    for (const hex of candidates) {
      let gain = 0
      for (const other of reach.get(hex)!) gain += deficit.get(other)!
      if (gain > bestGain) {
        best = hex
        bestGain = gain
      }
    }
    if (best === null) break

    const gained = { residents: 0, seniors: 0, noDevice: 0, noNight: 0 }
    const inReach = { residents: 0, seniors: 0 }
    for (const other of reach.get(best)!) {
      const state = byHex.get(other)!
      inReach.residents += state.residents
      inReach.seniors += state.seniors
      if (deficit.get(other)! > 0) {
        gained.residents += state.residents
        gained.seniors += state.seniors
        if (state.noDevice) gained.noDevice += state.residents
        if (state.noNight) gained.noNight += state.residents
      }
      deficit.set(other, 0)
    }
    const [lat, lon] = cellToLatLng(best)
    picks.push({
      rank,
      hex: best,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      reach: reach.get(best)!,
      gain: bestGain,
      gained: { residents: Math.round(gained.residents), seniors: Math.round(gained.seniors), noDevice: Math.round(gained.noDevice), noNight: Math.round(gained.noNight) },
      inReach: { residents: Math.round(inReach.residents), seniors: Math.round(inReach.seniors) },
      coveredHoursNow: byHex.get(best)!.coveredHours,
    })
  }
  return picks
}
