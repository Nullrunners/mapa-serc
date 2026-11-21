/** Handlers of the endpoints that answer from real data. Each is typed against its route in src/contract. */
import type { RouteHandler } from '@hono/zod-openapi'
import { FIELDS, GROUPS, SCHEMA_NAME, SCHEMA_TITLE, SCHEMA_VERSION, csvHeader, csvwMetadata, fieldDocsMarkdown, tableSchema, type AedRecord, type FieldDef } from '@aed/schema'
import { config, now, today } from './config'
import { getContext } from './context'
import {
  AedDetail,
  AedListResponse,
  HealthResponse,
  JobResult,
  MapFeatureCollection,
  SchemaResponse,
  StatsResponse,
  type aedDetailRoute,
  type aedListRoute,
  type healthRoute,
  type jobRoute,
  type mapRoute,
  type schemaRoute,
  type sourcesRoute,
  type statsRoute,
} from './contract'
import { ApiError } from './http/errors'
import { ok } from './http/respond'
import { runJob } from './jobs'
import { distanceM } from './pipeline/normalize'
import type { MergedAed } from './pipeline/merge'
import { csvCell, toCsv, toGeoJson, toJsonLd } from './publish/files'
import { harvesterXml, nationalFeed } from './publish/harvester'
import type { Context } from 'hono'

// --------------------------------------------------------------------- shared

const VOIVODESHIPS: Record<string, string> = {
  '02': 'dolnośląskie',
  '04': 'kujawsko-pomorskie',
  '06': 'lubelskie',
  '08': 'lubuskie',
  '10': 'łódzkie',
  '12': 'małopolskie',
  '14': 'mazowieckie',
  '16': 'opolskie',
  '18': 'podkarpackie',
  '20': 'podlaskie',
  '22': 'pomorskie',
  '24': 'śląskie',
  '26': 'świętokrzyskie',
  '28': 'warmińsko-mazurskie',
  '30': 'wielkopolskie',
  '32': 'zachodniopomorskie',
}

/** Communes in Poland (TERYT, 1 January 2026). */
const COMMUNES_TOTAL = 2479

/** "all" is everything fit to show on the public map: official and community, never pending or incomplete. */
const inLayer = (aed: MergedAed, layer: 'official' | 'community' | 'all') =>
  layer === 'all' ? aed.publication === 'official' || aed.publication === 'community' : aed.publication === layer

const count = (aeds: MergedAed[], publication: MergedAed['publication']) => aeds.filter((aed) => aed.publication === publication).length

/** Operator endpoints need `Authorization: Bearer <ADMIN_TOKEN>`. With no token configured they are closed. */
export function requireOperator(c: Context): void {
  const header = c.req.header('Authorization') ?? ''
  if (config.adminToken === '' || header !== `Bearer ${config.adminToken}`) {
    throw new ApiError(401, 'unauthorized', 'This action needs the operator token: Authorization: Bearer <ADMIN_TOKEN>.')
  }
}

// ----------------------------------------------------------------------- meta

export const healthHandler =
  (statuses: () => Record<string, 'stub' | 'live'>): RouteHandler<typeof healthRoute> =>
  async (c) => {
    const { store } = await getContext()
    return ok(c, HealthResponse, {
      status: 'ok',
      version: config.version,
      pipelineRanAt: store.ranAt,
      counts: { official: count(store.aeds, 'official'), community: count(store.aeds, 'community'), pending: count(store.aeds, 'pending'), incomplete: count(store.aeds, 'incomplete') },
      endpoints: statuses(),
      time: now(),
    })
  }

// ----------------------------------------------------------------------- data

export const aedListHandler: RouteHandler<typeof aedListRoute> = async (c) => {
  const { store } = await getContext()
  const query = c.req.valid('query')
  const bbox = query.bbox?.split(',').map(Number) as [number, number, number, number] | undefined
  const near = query.near?.split(',').map(Number) as [number, number] | undefined
  const text = query.q?.trim().toLowerCase()

  let matches = store.aeds
    .filter((aed) => inLayer(aed, query.layer))
    .filter((aed) => {
      const { record } = aed
      if (bbox && !(record.dlugosc_geograficzna >= bbox[0] && record.szerokosc_geograficzna >= bbox[1] && record.dlugosc_geograficzna <= bbox[2] && record.szerokosc_geograficzna <= bbox[3])) return false
      if (query.terc && !(record.kod_terc ?? '').startsWith(query.terc)) return false
      if (text && ![record.nazwa, record.nazwa_ulicy, record.miejscowosc, record.podmiot_odpowiedzialny].some((value) => value?.toLowerCase().includes(text))) return false
      return true
    })
    .map((aed) => ({ aed, distance: near ? Math.round(distanceM(near[0], near[1], aed.record.szerokosc_geograficzna, aed.record.dlugosc_geograficzna)) : null }))

  if (near) {
    if (query.radiusM !== undefined) matches = matches.filter((match) => match.distance! <= query.radiusM!)
    matches.sort((a, b) => a.distance! - b.distance!)
  } else {
    matches.sort((a, b) => a.aed.record.nazwa.localeCompare(b.aed.record.nazwa, 'pl') || a.aed.id.localeCompare(b.aed.id))
  }

  return ok(c, AedListResponse, {
    total: matches.length,
    items: matches.slice(query.offset, query.offset + query.limit).map(({ aed, distance }) => ({ id: aed.id, publication: aed.publication, quality: aed.quality, distanceM: distance, record: aed.record })),
  })
}

export const aedDetailHandler: RouteHandler<typeof aedDetailRoute> = async (c) => {
  const { store } = await getContext()
  const { id } = c.req.valid('param')
  const aed = store.get(id)
  if (!aed) throw new ApiError(404, 'not_found', `No device with id ${id}.`)
  const reports = new Map(store.reports.map((report) => [report.id, report]))
  const history = await store.history(id)
  return ok(c, AedDetail, {
    id: aed.id,
    publication: aed.publication,
    quality: aed.quality,
    distanceM: null,
    record: aed.record,
    provenance: aed.provenance as Record<string, string>,
    sources: aed.sources.map((ref) => ({ ...ref, name: reports.get(ref.sourceId)?.name ?? ref.sourceId, licence: reports.get(ref.sourceId)?.licence ?? '' })),
    issues: aed.issues,
    history: history.map(({ at, actor, action, detail }) => ({ at, actor, action, detail })),
  })
}

export const mapHandler: RouteHandler<typeof mapRoute> = async (c) => {
  const { store } = await getContext()
  const { layer } = c.req.valid('query')
  return ok(c, MapFeatureCollection, {
    type: 'FeatureCollection',
    features: store.aeds
      .filter((aed) => inLayer(aed, layer))
      .map((aed) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [aed.record.dlugosc_geograficzna, aed.record.szerokosc_geograficzna] as [number, number] },
        properties: {
          id: aed.id,
          nazwa: aed.record.nazwa,
          publication: aed.publication,
          dostep: aed.record.dostep,
          godziny_dostepnosci: aed.record.godziny_dostepnosci,
          status: aed.record.status,
          quality: aed.quality,
        },
      })),
  })
}

export const statsHandler: RouteHandler<typeof statsRoute> = async (c) => {
  const { store } = await getContext()
  const official = store.aeds.filter((aed) => aed.publication === 'official')
  const byVoivodeship = Object.entries(VOIVODESHIPS).map(([terc, name]) => ({
    terc,
    name,
    official: official.filter((aed) => aed.record.kod_terc?.startsWith(terc)).length,
    community: store.aeds.filter((aed) => aed.publication === 'community' && aed.record.kod_terc?.startsWith(terc)).length,
  }))
  return ok(c, StatsResponse, {
    pipelineRanAt: store.ranAt,
    official: official.length,
    community: count(store.aeds, 'community'),
    pending: count(store.aeds, 'pending'),
    incomplete: count(store.aeds, 'incomplete'),
    averageQuality: official.length > 0 ? Math.round((official.reduce((sum, aed) => sum + aed.quality, 0) / official.length) * 10) / 10 : null,
    reviewPairs: store.reviews.length,
    byVoivodeship,
    communesWithOfficial: new Set(official.map((aed) => aed.record.kod_terc)).size,
    communesTotal: COMMUNES_TOTAL,
  })
}

export const sourcesHandler: RouteHandler<typeof sourcesRoute> = async (c) => {
  const { store } = await getContext()
  return c.json({ items: store.reports }, 200)
}

export const schemaHandler: RouteHandler<typeof schemaRoute> = (c) =>
  ok(c, SchemaResponse, {
    name: SCHEMA_NAME,
    title: SCHEMA_TITLE,
    version: SCHEMA_VERSION,
    groups: GROUPS.map((group) => ({ ...group })),
    fields: (FIELDS as readonly FieldDef[]).map((field) => ({
      name: field.name,
      group: field.group,
      type: field.type,
      requirement: field.requirement,
      title: field.title,
      description: field.description,
      example: field.example,
      enum: field.enum ? [...field.enum] : null,
      enumLabels: field.enumLabels ? [...field.enumLabels] : null,
      pattern: field.pattern ?? null,
      osm: field.osm ?? null,
      geoDae: field.geoDae ?? null,
    })),
  })

// ---------------------------------------------------------------------- files

type FileHandler = (c: Context) => Promise<Response> | Response

const send = (c: Context, body: string, contentType: string, fileName?: string) =>
  c.body(body, 200, {
    'Content-Type': contentType,
    ...(fileName ? { 'Content-Disposition': `inline; filename="${fileName}"` } : {}),
    // Re-users and the portal's harvester may cache for a short while; the data changes at most a few times a day.
    'Cache-Control': 'public, max-age=300',
  })

const records = async (publication: 'official' | 'community'): Promise<AedRecord[]> => {
  const { store } = await getContext()
  return store.aeds
    .filter((aed) => aed.publication === publication)
    .map((aed) => aed.record)
    .sort((a, b) => (a.kod_terc ?? '').localeCompare(b.kod_terc ?? '') || a.nazwa.localeCompare(b.nazwa, 'pl') || a.id.localeCompare(b.id))
}

export const csvHandler: FileHandler = async (c) => send(c, toCsv(await records('official')), 'text/csv; charset=utf-8', 'aed.csv')
export const geojsonHandler: FileHandler = async (c) => send(c, JSON.stringify(toGeoJson(await records('official'))), 'application/geo+json; charset=utf-8', 'aed.geojson')
export const jsonldHandler: FileHandler = async (c) =>
  send(c, JSON.stringify(toJsonLd(await records('official'), `${config.publicApiUrl}/dane/aed.jsonld`)), 'application/ld+json; charset=utf-8', 'aed.jsonld')
export const csvwHandler: FileHandler = (c) => send(c, JSON.stringify(csvwMetadata(`${config.publicApiUrl}/dane/aed.csv`), null, 2), 'application/csvm+json; charset=utf-8')
export const tableSchemaHandler: FileHandler = (c) => send(c, JSON.stringify(tableSchema(), null, 2), 'application/json; charset=utf-8', 'wzorzec-danych-aed.schema.json')
export const patternDocHandler: FileHandler = (c) => send(c, fieldDocsMarkdown(), 'text/markdown; charset=utf-8', 'wzorzec-danych-aed.md')
export const communityHandler: FileHandler = async (c) => send(c, JSON.stringify(toGeoJson(await records('community'))), 'application/geo+json; charset=utf-8', 'aed-osm.geojson')

/** Header plus one example row built from the examples in the field catalogue; `id` is left to the system. */
export const templateHandler: FileHandler = (c) => {
  const example = (FIELDS as readonly FieldDef[]).map((field) => (['id', 'zrodlo', 'licencja', 'data_aktualizacji'].includes(field.name) ? '' : csvCell(field.example)))
  return send(c, `${csvHeader().join(',')}\r\n${example.join(',')}\r\n`, 'text/csv; charset=utf-8', 'szablon-aed.csv')
}

export const feedHandler: FileHandler = async (c) => {
  const { store } = await getContext()
  const official = await records('official')
  const xml = harvesterXml(
    nationalFeed({
      baseUrl: config.publicApiUrl,
      landingPage: config.publicWebUrl,
      count: official.length,
      attributions: [...new Set(official.flatMap((record) => record.zrodlo.split('; ')))].sort((a, b) => a.localeCompare(b, 'pl')),
      dataDate: official.reduce((latest, record) => (record.data_aktualizacji > latest ? record.data_aktualizacji : latest), '') || today(),
      lastUpdate: store.ranAt ?? now(),
    }),
  )
  // The portal's schema accepts only https links. A local or misconfigured deployment still serves the feed,
  // so that it can be inspected, but says plainly why the portal would refuse it.
  if (!config.publicApiUrl.startsWith('https://')) {
    c.header('X-Feed-Warning', 'PUBLIC_API_URL is not https; dane.gov.pl will reject the resource links')
    return send(c, xml.replace('\n', '\n<!-- PUBLIC_API_URL is not https: dane.gov.pl accepts only https resource links. Set PUBLIC_API_URL in the deployment. -->\n'), 'application/xml; charset=utf-8')
  }
  return send(c, xml, 'application/xml; charset=utf-8')
}

// ---------------------------------------------------------------------- admin

export const jobHandler: RouteHandler<typeof jobRoute> = async (c) => {
  requireOperator(c)
  const { name } = c.req.valid('param')
  const options = c.req.header('Content-Type')?.includes('application/json') ? c.req.valid('json') : { refresh: false }
  const started = Date.now()
  const summary = await runJob(name, options)
  return ok(c, JobResult, { job: name, tookMs: Date.now() - started, summary })
}
