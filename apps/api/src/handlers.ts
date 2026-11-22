/** Handlers of the endpoints that answer from real data. Each is typed against its route in src/contract. */
import { createHash } from 'node:crypto'
import type { RouteHandler } from '@hono/zod-openapi'
import { FIELDS, GROUPS, SCHEMA_NAME, SCHEMA_TITLE, SCHEMA_VERSION, SYSTEM_FIELDS, csvHeader, csvwMetadata, fieldDocsMarkdown, reachableNow, tableSchema, type AedRecord, type FieldDef } from '@aed/schema'
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
  type providerFeedHashRoute,
  type providerFeedRoute,
  type schemaRoute,
  type sourcesRoute,
  type statsRoute,
} from './contract'
import { ApiError } from './http/errors'
import { KeptBodies, keepJson, sendKept } from './http/kept'
import { ok } from './http/respond'
import { runJob } from './jobs'
import { KNOWN_SOURCES } from './pipeline/known'
import { distanceM } from './pipeline/normalize'
import type { MergedAed } from './pipeline/merge'
import { summariseReports } from './passport/model'
import { csvCell, toCsv, toGeoJson, toJsonLd, toScopeCsv } from './publish/files'
import { reach, soonestInHand } from './reach/score'
import { harvesterXml, isPortalLicence, providerFeed } from './publish/harvester'
import { feedBlocker, feedUrls, providerRecords } from './publish/providers'
import { patternWorkbook } from './publish/xlsx'
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
  const at = query.at ? new Date(query.at) : new Date(now())
  const nowIso = now()
  /** A problem passers-by reported and nobody has resolved yet. */
  const problem = (aed: MergedAed) => {
    const reports = store.passports.reportsOf(aed.id)
    return reports.length > 0 && summariseReports(reports, store.passports.get(aed.id)?.confirmedAt ?? null, nowIso).problems.length > 0
  }

  const found = store.aeds.filter((aed) => {
    if (!inLayer(aed, query.layer)) return false
    const { record } = aed
    if (query.availableNow === 'true' && reachableNow(record, at) !== 'yes') return false
    if (bbox && !(record.dlugosc_geograficzna >= bbox[0] && record.szerokosc_geograficzna >= bbox[1] && record.dlugosc_geograficzna <= bbox[2] && record.szerokosc_geograficzna <= bbox[3])) return false
    if (query.terc && !(record.kod_terc ?? '').startsWith(query.terc)) return false
    // The words about the spot count too: for a device nobody named they are where the name of the place ends up.
    if (text && ![record.nazwa, record.nazwa_ulicy, record.miejscowosc, record.podmiot_odpowiedzialny, record.opis_lokalizacji].some((value) => value?.toLowerCase().includes(text))) return false
    return true
  })

  const last = query.offset + query.limit
  let total = found.length
  let page: { aed: MergedAed; distance: number | null }[]
  if (near) {
    let measured = found.map((aed) => ({ aed, distance: Math.round(distanceM(near[0], near[1], aed.record.szerokosc_geograficzna, aed.record.dlugosc_geograficzna)) }))
    if (query.radiusM !== undefined) measured = measured.filter((match) => match.distance <= query.radiusM!)
    total = measured.length
    measured.sort((a, b) => a.distance - b.distance)
    // By reach only the devices that can make this page are scored; see `soonestInHand`.
    page = (query.sort === 'reach' ? soonestInHand(measured, last, (match) => reach(match.aed.record, match.distance, at, { problem: problem(match.aed) }).score) : measured).slice(query.offset, last)
  } else {
    // Without a point to measure from: devices confirmed by their keeper first, then by name.
    const rank = (aed: MergedAed) => (aed.publication === 'official' ? 0 : 1)
    page = found
      .sort((a, b) => rank(a) - rank(b) || a.record.nazwa.localeCompare(b.record.nazwa, 'pl') || a.id.localeCompare(b.id))
      .slice(query.offset, last)
      .map((aed) => ({ aed, distance: null }))
  }

  return ok(c, AedListResponse, {
    total,
    items: page.map(({ aed, distance }) => ({
      id: aed.id,
      publication: aed.publication,
      quality: aed.quality,
      distanceM: distance,
      availableNow: reachableNow(aed.record, at),
      record: aed.record,
      ...(distance === null ? {} : { reach: reach(aed.record, distance, at, { problem: problem(aed), withChange: true }) }),
    })),
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
    availableNow: reachableNow(aed.record, new Date(now())),
    record: aed.record,
    provenance: aed.provenance as Record<string, string>,
    sources: aed.sources.map((ref) => ({ ...ref, name: reports.get(ref.sourceId)?.name ?? ref.sourceId, licence: reports.get(ref.sourceId)?.licence ?? '' })),
    issues: aed.issues,
    history: history.map(({ at, actor, action, detail }) => ({ at, actor, action, detail })),
  })
}

/** The map layers as sent: every page with a map asks for one, and it is the same until a device changes. */
const mapLayers = new KeptBodies<number, typeof MapFeatureCollection>()

export const mapHandler: RouteHandler<typeof mapRoute> = async (c) => {
  const { store } = await getContext()
  const { layer } = c.req.valid('query')
  const kept = await mapLayers.get(layer, store.revision, () =>
    keepJson(c, MapFeatureCollection, {
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
    }),
  )
  // Asked about every time: a keeper who has just changed a device must see it on the map.
  return sendKept(c, kept)
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
  const feeds = feedUrls(store)
  return c.json({ items: store.reports.map((report) => ({ ...report, feedUrl: feeds.get(report.id) ?? null })), notIncluded: KNOWN_SOURCES }, 200)
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

const send = (c: Context, body: string | Uint8Array<ArrayBuffer>, contentType: string, fileName?: string) =>
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
export const patternXlsxHandler: FileHandler = async (c) =>
  send(c, await patternWorkbook(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'wzorzec-danych-aed.xlsx')

/** Every published source's data scope against the pattern. A submission that awaits approval is not public yet. */
export const sourceScopeHandler: FileHandler = async (c) => {
  const { store } = await getContext()
  return send(c, toScopeCsv(store.reports.filter((report) => !report.awaitingApproval)), 'text/csv; charset=utf-8', 'zakres-zrodel.csv')
}

/** Header plus one example row built from the examples in the field catalogue; the system's own columns stay empty. */
export const templateHandler: FileHandler = (c) => {
  const example = (FIELDS as readonly FieldDef[]).map((field) => ((SYSTEM_FIELDS as readonly string[]).includes(field.name) ? '' : csvCell(field.example)))
  return send(c, `${csvHeader().join(',')}\r\n${example.join(',')}\r\n`, 'text/csv; charset=utf-8', 'szablon-aed.csv')
}

/** The feed of one provider, exactly as served: the harvester compares its MD5 with the .md5 file next to it. */
const providerFeedXml = async (id: string): Promise<string> => {
  const { store } = await getContext()
  const report = store.reports.find((candidate) => candidate.id === id)
  if (!report) throw new ApiError(404, 'not_found', `No source with id ${id}.`)
  const own = providerRecords(store, id)
  const blocker = feedBlocker(report, own.length)
  if (blocker !== null || !isPortalLicence(report.licence)) throw new ApiError(409, 'conflict', blocker ?? 'Licence outside the portal list.')
  const xml = harvesterXml(
    providerFeed({
      baseUrl: config.publicApiUrl,
      landingPage: report.landingPage ?? config.publicWebUrl,
      source: { id, name: report.name, attribution: report.attribution, licence: report.licence },
      count: own.length,
      dataDate: own.reduce((latest, record) => (record.data_aktualizacji > latest ? record.data_aktualizacji : latest), '') || today(),
      lastUpdate: store.ranAt ?? now(),
    }),
  )
  // The portal's schema accepts only https links. A local or misconfigured deployment still serves the feed,
  // so that it can be inspected, but says plainly why the portal would refuse it.
  if (!config.publicApiUrl.startsWith('https://')) {
    return xml.replace('\n', '\n<!-- PUBLIC_API_URL is not https: dane.gov.pl accepts only https resource links. Set PUBLIC_API_URL in the deployment. -->\n')
  }
  return xml
}

/** One provider's dataset for the portal's harvester; the portal merges every provider into the summary list. */
export const providerFeedHandler: RouteHandler<typeof providerFeedRoute> = async (c) => {
  const xml = await providerFeedXml(c.req.valid('param').id)
  if (!config.publicApiUrl.startsWith('https://')) c.header('X-Feed-Warning', 'PUBLIC_API_URL is not https; dane.gov.pl will reject the resource links')
  return send(c, xml, 'application/xml; charset=utf-8')
}

/** The harvester reads this before the feed (same address, .md5 instead of .xml) and rejects a feed whose MD5 differs. */
export const providerFeedHashHandler: RouteHandler<typeof providerFeedHashRoute> = async (c) => {
  const xml = await providerFeedXml(c.req.valid('param').id)
  return send(c, `${createHash('md5').update(xml, 'utf8').digest('hex')}\n`, 'text/plain; charset=utf-8')
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
