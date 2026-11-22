/** Gap endpoints: where residents have no defibrillator in reach, and where new ones would help most. */
import type { RouteHandler } from '@hono/zod-openapi'
import { getContext } from '../context'
import {
  GapsCommune,
  GapsLocalities,
  GapsMethod,
  GapsGrid,
  GapsNear,
  GapsOverview,
  GapsSummary,
  GapsView,
  type GapsQuery,
  type gapsCommuneRoute,
  type gapsCsvRoute,
  type gapsGridRoute,
  type gapsLocalitiesRoute,
  type gapsNearRoute,
  type gapsOverviewRoute,
  type gapsRoute,
  type gapsSummaryRoute,
} from '../contract'
import type { z } from '@hono/zod-openapi'
import type { Store } from '../db/store'
import { ApiError } from '../http/errors'
import { KeptBodies, keepJson, sendKept } from '../http/kept'
import { ok } from '../http/respond'
import { csvCell } from '../publish/files'
import { areaKm2, parseBbox, parseRing, shapeArea, type Area } from './area'
import { communeAt, communeByTerc, localitiesNamed } from './commune'
import { hexPolygon, levelFigures, levelIn, OVERVIEW_RES, REACH_M, RES, SENIOR_WEIGHT, type HexState } from './engine'
import { POPULATION_SOURCE } from './population'
import { analyseView, hexesNear, MAX_CELLS, overviewAtHand, overviewFor, supplyFor, type PlaceReport, type TimedOverview } from './state'
import { WEEK_HOURS } from '@aed/schema'
import { ASSUMED_HOURS } from './supply'

const OSM_SOURCE = {
  name: 'Defibrylatory: zbiory urzędowe z dane.gov.pl i OpenStreetMap',
  url: 'https://www.openstreetmap.org/copyright',
  licence: 'ODbL 1.0',
  attribution: '© autorzy OpenStreetMap (ODbL 1.0) oraz instytucje podane przy każdym urządzeniu urzędowym. Wynik analizy jest na licencji ODbL 1.0.',
}

function method(store: Store): z.input<typeof GapsMethod> {
  const { counts, points } = supplyFor(store)
  return {
    resolution: RES,
    reachM: REACH_M,
    seniorWeight: SENIOR_WEIGHT,
    nightHour: 'niedziela 3:00',
    assumedHours: ASSUMED_HOURS,
    devices: { total: points.length, ...counts },
    sources: [{ ...POPULATION_SOURCE }, OSM_SOURCE],
    datasetRanAt: store.ranAt,
  }
}

export const gapsSummaryHandler: RouteHandler<typeof gapsSummaryRoute> = async (c) => {
  const { store } = await getContext()
  // Answer at once while the country is being counted for the first time; the page asks again.
  const overview = overviewAtHand(store)
  return ok(c, GapsSummary, {
    ready: overview !== null,
    computedAt: overview?.computedAt ?? null,
    tookMs: overview?.tookMs ?? null,
    totals: overview?.totals ?? { residents: 0, seniors: 0, noDevice: 0, noNight: 0, coveredShare: 0 },
    method: method(store),
  })
}

/** The country's layer as sent: a few megabytes that every visit of the page asks for, the same until the figures are counted again. */
const overviewLayer = new KeptBodies<TimedOverview, typeof GapsOverview>()

export const gapsOverviewHandler: RouteHandler<typeof gapsOverviewRoute> = async (c) => {
  const { store } = await getContext()
  const overview = overviewAtHand(store) ?? (await overviewFor(store))
  const kept = await overviewLayer.get('overview', overview, () => {
    const level = overview.levels.get(OVERVIEW_RES)!
    const features = level.hexes
      .map((hex, i) => ({ hex, i }))
      .sort((a, b) => (a.hex < b.hex ? -1 : 1))
      .map(({ hex, i }) => ({ type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: hexPolygon(hex) }, properties: { hex, ...levelFigures(level, i) } }))
    return keepJson(c, GapsOverview, { type: 'FeatureCollection', features })
  })
  return sendKept(c, kept, 'public, max-age=300')
}

const round1 = (value: number) => Math.round(value * 10) / 10

const hexFeature = (state: HexState) => ({
  type: 'Feature' as const,
  geometry: { type: 'Polygon' as const, coordinates: hexPolygon(state.hex) },
  properties: {
    hex: state.hex,
    residents: round1(state.residents),
    coveredHours: state.coveredHours,
    noDevice: state.noDevice,
    noNight: state.noNight,
    uncovered: round1((state.residents * (WEEK_HOURS - state.coveredHours)) / WEEK_HOURS),
  },
})

/** The one area the query names: a box, a drawn shape or a commune looked up before. */
async function areaOf(store: Store, query: z.output<typeof GapsQuery>): Promise<Area> {
  if (query.bbox) return { bbox: parseBbox(query.bbox), shape: null }
  if (query.area) {
    const ring = parseRing(query.area)
    if (!ring) throw new ApiError(422, 'validation_error', 'Kształt musi mieć od 3 do 100 wierzchołków.')
    return shapeArea([[ring]])
  }
  return (await communeByTerc(store, query.terc!)).area
}

async function view(query: z.output<typeof GapsQuery>) {
  const { store, geo } = await getContext()
  const area = await areaOf(store, query)
  const result = await analyseView(store, geo, area, query.n)
  return { store, area, result }
}

export const gapsHandler: RouteHandler<typeof gapsRoute> = async (c) => {
  const query = c.req.valid('query')
  const { store, area, result } = await view(query)
  return ok(c, GapsView, {
    tooLarge: result.tooLarge,
    cells: result.cells,
    maxCells: MAX_CELLS,
    km2: round1(areaKm2(area)),
    totals: result.totals,
    hexes: { type: 'FeatureCollection', features: query.hexes === '0' ? [] : result.hexes.map(hexFeature) },
    places: result.places.map(({ reach: _, ...place }) => ({ ...place, boundary: { type: 'Polygon' as const, coordinates: hexPolygon(place.hex) } })),
    method: method(store),
  })
}

export const gapsNearHandler: RouteHandler<typeof gapsNearRoute> = async (c) => {
  const { store } = await getContext()
  const { tooLarge, hexes } = hexesNear(store, parseBbox(c.req.valid('query').bbox))
  c.header('Cache-Control', 'public, max-age=300')
  return ok(c, GapsNear, { type: 'FeatureCollection', tooLarge, features: hexes.map(hexFeature) })
}

/** Most hexagons one answer of the grid may hold: the whole country at resolution 6 fits, at 7 it does not. */
const MAX_GRID = 12_000

/** Built answers of the grid, ready to send. Bounded: anyone may ask for any box. */
const gridAnswers = new KeptBodies<unknown, typeof GapsGrid>(600)

/**
 * The map asks in boxes of a fixed grid, so the same box comes again and again, from everybody: each is built,
 * checked and compressed once per count, and a browser that has it gets "304 Not Modified". Resolution 9 is counted
 * for the box, like the close-up of a view; the coarser ones are cut from the national count.
 */
export const gapsGridHandler: RouteHandler<typeof gapsGridRoute> = async (c) => {
  const { store } = await getContext()
  const { res, bbox: text } = c.req.valid('query')
  const bbox = parseBbox(text)
  const key = `${res}:${bbox.join(',')}`
  const answer = (hexes: string[], residents: number[], uncovered: number[], tooLarge = false) => keepJson(c, GapsGrid, { res, tooLarge, hexes, residents, uncovered })
  let kept
  if (res === RES) {
    kept = await gridAnswers.get(key, supplyFor(store).key, () => {
      const { tooLarge, hexes } = hexesNear(store, bbox)
      return answer(
        hexes.map((state) => state.hex),
        hexes.map((state) => round1(state.residents)),
        hexes.map((state) => round1((state.residents * (WEEK_HOURS - state.coveredHours)) / WEEK_HOURS)),
        tooLarge,
      )
    })
  } else {
    const overview = overviewAtHand(store) ?? (await overviewFor(store))
    kept = await gridAnswers.get(key, overview, () => {
      const level = overview.levels.get(res)!
      const found = levelIn(level, bbox)
      if (found.length > MAX_GRID) return answer([], [], [], true)
      const figures = found.map((i) => levelFigures(level, i))
      return answer(
        found.map((i) => level.hexes[i]!),
        figures.map((figure) => figure.residents),
        figures.map((figure) => figure.uncovered),
      )
    })
  }
  return sendKept(c, kept, 'public, max-age=300')
}

export const gapsCommuneHandler: RouteHandler<typeof gapsCommuneRoute> = async (c) => {
  const [lon, lat] = c.req.valid('query').at.split(',').map(Number) as [number, number]
  const { store, geo } = await getContext()
  const { area, ...commune } = await communeAt(store, geo, lat, lon)
  return ok(c, GapsCommune, { ...commune, km2: round1(areaKm2(area)), bbox: area.bbox, boundary: { type: 'MultiPolygon', coordinates: area.shape } })
}

export const gapsLocalitiesHandler: RouteHandler<typeof gapsLocalitiesRoute> = async (c) => {
  const { geo } = await getContext()
  return ok(c, GapsLocalities, { items: await localitiesNamed(geo, c.req.valid('query').q) })
}

const CSV_HEADER = [
  'miejsce',
  'szerokosc_geograficzna',
  'dlugosc_geograficzna',
  'adres_w_poblizu',
  'gmina',
  'kod_terc',
  'mieszkancy_w_zasiegu',
  'w_tym_65_plus',
  'zyskuja_dostep_calodobowy',
  'bez_zadnego_aed_dzis',
  'bez_aed_w_nocy_dzis',
  'godzin_tygodnia_z_aed_dzis',
  'najblizszy_aed_calodobowy_m',
  'aed_w_promieniu_600_m',
  'h3',
]

export function placesCsv(places: readonly PlaceReport[]): string {
  const rows = places.map((place) => [
    place.rank,
    place.lat,
    place.lon,
    place.address,
    place.commune?.gmina,
    place.commune?.terc,
    place.inReach.residents,
    place.inReach.seniors,
    place.gained.residents,
    place.gained.noDevice,
    place.gained.noNight,
    place.coveredHoursNow,
    place.nearestAllWeek?.distanceM,
    place.nearby.length,
    place.hex,
  ])
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export const gapsCsvHandler: RouteHandler<typeof gapsCsvRoute> = async (c) => {
  const { result } = await view(c.req.valid('query'))
  return c.body(placesCsv(result.places), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="miejsca-na-nowe-aed.csv"',
    'Cache-Control': 'public, max-age=300',
  })
}


