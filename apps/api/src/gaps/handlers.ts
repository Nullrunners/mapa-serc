/** Gap endpoints: where residents have no defibrillator in reach, and where new ones would help most. */
import type { RouteHandler } from '@hono/zod-openapi'
import { getContext } from '../context'
import { GapsMethod, GapsOverview, GapsSummary, GapsView, type gapsCsvRoute, type gapsOverviewRoute, type gapsRoute, type gapsSummaryRoute } from '../contract'
import type { z } from '@hono/zod-openapi'
import type { Store } from '../db/store'
import { ok } from '../http/respond'
import { csvCell } from '../publish/files'
import { hexPolygon, REACH_M, RES, SENIOR_WEIGHT } from './engine'
import { POPULATION_SOURCE } from './population'
import { analyseView, MAX_CELLS, overviewFor, supplyFor, type Bbox, type PlaceReport } from './state'
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

export const gapsOverviewHandler: RouteHandler<typeof gapsOverviewRoute> = async (c) => {
  const { store } = await getContext()
  const overview = await overviewFor(store)
  const features = [...overview.areas.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([hex, area]) => {
      const { residents, noDevice, noNight, coveredShare } = area.result()
      return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: hexPolygon(hex) }, properties: { hex, residents, noDevice, noNight, coveredShare } }
    })
  c.header('Cache-Control', 'public, max-age=300')
  return ok(c, GapsOverview, { type: 'FeatureCollection', features })
}

function parseBbox(text: string): Bbox {
  const [a, b, c, d] = text.split(',').map(Number) as [number, number, number, number]
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

async function view(query: { bbox: string; n: number }) {
  const { store, geo } = await getContext()
  const result = await analyseView(store, geo, parseBbox(query.bbox), query.n)
  return { store, result }
}

const round1 = (value: number) => Math.round(value * 10) / 10

export const gapsHandler: RouteHandler<typeof gapsRoute> = async (c) => {
  const { store, result } = await view(c.req.valid('query'))
  return ok(c, GapsView, {
    tooLarge: result.tooLarge,
    cells: result.cells,
    maxCells: MAX_CELLS,
    totals: result.totals,
    hexes: {
      type: 'FeatureCollection',
      features: result.hexes.map((state) => ({
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
      })),
    },
    places: result.places.map(({ reach: _, ...place }) => ({ ...place, boundary: { type: 'Polygon' as const, coordinates: hexPolygon(place.hex) } })),
    method: method(store),
  })
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


