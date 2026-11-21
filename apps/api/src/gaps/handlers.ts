/** Gap endpoints: where residents have no defibrillator in reach, and where new ones would help most. */
import type { RouteHandler } from '@hono/zod-openapi'
import { getContext } from '../context'
import {
  GapsCommune,
  GapsLocalities,
  GapsMethod,
  GapsNear,
  GapsOverview,
  GapsSummary,
  GapsView,
  type GapsQuery,
  type gapsCommuneRoute,
  type gapsCsvRoute,
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
import { hexPolygon, REACH_M, RES, SENIOR_WEIGHT, type HexState } from './engine'
import { POPULATION_SOURCE } from './population'
import { analyseView, hexesNear, MAX_CELLS, overviewFor, supplyFor, type PlaceReport, type TimedOverview } from './state'
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
  const pending = overviewFor(store)
  // Answer at once while the country is still being counted; the page asks again.
  const overview = await Promise.race([pending, new Promise<null>((done) => setTimeout(() => done(null), 50))])
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
  const overview = await overviewFor(store)
  const kept = await overviewLayer.get('overview', overview, () => {
    const features = [...overview.areas.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([hex, area]) => {
        const { residents, noDevice, noNight, coveredShare } = area.result()
        const uncovered = Math.round(residents * (1 - coveredShare))
        return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: hexPolygon(hex) }, properties: { hex, residents, noDevice, noNight, coveredShare, uncovered } }
      })
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
    uncovered: round1((state.residents * (168 - state.coveredHours)) / 168),
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
  const { store, area, result } = await view(c.req.valid('query'))
  return ok(c, GapsView, {
    tooLarge: result.tooLarge,
    cells: result.cells,
    maxCells: MAX_CELLS,
    km2: round1(areaKm2(area)),
    totals: result.totals,
    hexes: { type: 'FeatureCollection', features: result.hexes.map(hexFeature) },
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


