/**
 * The whole merge, from source files to national records:
 * read → normalise → per-source checks → registers (coordinates, TERC) → deduplicate → addresses for OSM → merge → report.
 * No database in here: the caller passes what was stored and persists what comes back.
 */
import { UNNAMED_PLACE, type AedRecord } from '@aed/schema'
import { sourceCoverage, type FieldCoverage } from './coverage'
import { cluster, type DedupItem } from './dedup'
import { addressFromPoint, enrich, type Geo } from './geocode'
import { memberKey, mergeCluster, type MergedAed } from './merge'
import { checkSource, normalizeSource, parseSource, publicUrl, readSourceBytes, type Origin } from './sources'
import { PRIORITY, type Fix, type FixCode, type Issue, type IssueCode, type NormalizedRecord, type SourceDef } from './types'

export interface StoredSource {
  def: SourceDef
  records: NormalizedRecord[]
}

export interface PipelineInput {
  /** Sources read from files (apps/api/sources/*.json). */
  defs: SourceDef[]
  /** Sources that live in the database: wizard uploads and owner submissions. */
  stored: StoredSource[]
  rawDir: string | null
  /** Download fresh copies; otherwise use the last downloaded copy or the frozen fixture. */
  refresh: boolean
  /** Values for the `{NAME}` placeholders in source addresses (API keys). They never leave the download step. */
  secrets?: Record<string, string>
  /** Registers client; null skips the network step (tests, offline). */
  geo: Geo | null
  /**
   * Registers client that answers only from its cache. Used for OpenStreetMap (commune codes and addresses):
   * 18 thousand lookups are too many for a normal run, so a separate job fills the cache and every run then reads from it.
   */
  cachedGeo: Geo | null
  /** member key → id already assigned in the national dataset. */
  existingIds: Map<string, string>
  /** Records as published by the previous run, to keep `data_aktualizacji` when nothing changed. */
  previous: Map<string, AedRecord>
  today: string
}

export interface ReportLine<Code extends string> {
  code: Code
  count: number
  /** Message of the first occurrence, as an example the provider can act on. */
  example: string
}

/** What a provider needs to know about their file: what we read, what we repaired, what we could not. */
export interface SourceReport {
  id: string
  kind: SourceDef['kind']
  /** A wizard submission the operator has not approved yet. */
  awaitingApproval: boolean
  name: string
  attribution: string
  licence: SourceDef['licence']
  url: string
  landingPage: string | null
  origin: Origin | 'database' | 'missing'
  error: string | null
  readAt: string
  rows: number
  /** Devices of this source by where they ended up. */
  official: number
  community: number
  pending: number
  incomplete: number
  fileFixes: Fix[]
  fixes: ReportLine<FixCode>[]
  issues: (ReportLine<IssueCode> & { severity: Issue['severity'] })[]
  /** The source's data scope against the pattern: one entry per field a source can deliver. */
  coverage: FieldCoverage[]
}

export interface ReviewPair {
  id: string
  a: { sourceId: string; sourceKey: string }
  b: { sourceId: string; sourceKey: string }
  score: number
  distanceM: number
}

export interface PipelineResult {
  ranAt: string
  aeds: MergedAed[]
  records: NormalizedRecord[]
  reviews: ReviewPair[]
  reports: SourceReport[]
}

function tally<Code extends string, Extra>(entries: { code: Code; message: string }[], extra: (code: Code) => Extra): (ReportLine<Code> & Extra)[] {
  const lines = new Map<Code, ReportLine<Code> & Extra>()
  for (const entry of entries) {
    const line = lines.get(entry.code)
    if (line) line.count++
    else lines.set(entry.code, { code: entry.code, count: 1, example: entry.message, ...extra(entry.code) })
  }
  return [...lines.values()].sort((a, b) => b.count - a.count)
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const ranAt = new Date().toISOString()
  const sources = new Map<string, SourceDef>()
  const records: NormalizedRecord[] = []
  const reports = new Map<string, SourceReport>()

  const report = (def: SourceDef, origin: SourceReport['origin'], rows: number, fileFixes: Fix[], error: string | null) =>
    reports.set(def.id, {
      id: def.id,
      kind: def.kind,
      awaitingApproval: def.pending === true,
      name: def.name,
      attribution: def.attribution,
      licence: def.licence,
      url: publicUrl(def),
      landingPage: def.landingPage ?? null,
      origin,
      error,
      readAt: ranAt,
      rows,
      official: 0,
      community: 0,
      pending: 0,
      incomplete: 0,
      fileFixes,
      fixes: [],
      issues: [],
      coverage: [],
    })

  for (const def of input.defs) {
    sources.set(def.id, def)
    const file = await readSourceBytes(def, { rawDir: input.rawDir, refresh: input.refresh, secrets: input.secrets })
    if (!file) {
      report(def, 'missing', 0, [], 'Źródło nie zostało jeszcze pobrane.')
      continue
    }
    try {
      const table = parseSource(def, file.bytes)
      const normalised = normalizeSource(def, table)
      checkSource(def, normalised)
      records.push(...normalised)
      report(def, file.origin, normalised.length, table.fixes, file.error ?? null)
    } catch (cause) {
      report(def, file.origin, 0, [], `Nie udało się odczytać pliku: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  for (const { def, records: stored } of input.stored) {
    sources.set(def.id, def)
    // Stored records are normalised already; copy them so that this run's fixes do not pile up in the database.
    records.push(...stored.map((record) => ({ ...record, input: { ...record.input }, fixes: [...record.fixes], issues: [...record.issues] })))
    report(def, 'database', stored.length, [], null)
  }

  const isOsm = (record: NormalizedRecord) => sources.get(record.sourceId)!.kind === 'osm'
  if (input.geo) await enrich(records.filter((record) => !isOsm(record)), input.geo)
  if (input.cachedGeo) await enrich(records.filter(isOsm), input.cachedGeo, { geocodeAddresses: false })

  /** Records of other sources that the record's own source says are the same device (SourceDef.refs). */
  const refsOf = (record: NormalizedRecord) =>
    Object.entries(sources.get(record.sourceId)!.refs ?? {}).flatMap(([column, sourceId]) => {
      const key = (record.raw[column] ?? '').trim()
      return key === '' ? [] : [{ sourceId, key }]
    })

  const located: DedupItem[] = []
  const unlocated: number[] = []
  records.forEach((record, index) => {
    const { szerokosc_geograficzna: lat, dlugosc_geograficzna: lon } = record.input
    if (lat == null || lon == null) return void unlocated.push(index)
    located.push({
      index,
      sourceId: record.sourceId,
      key: record.sourceKey,
      refs: refsOf(record),
      priority: PRIORITY[sources.get(record.sourceId)!.kind],
      lat,
      lon,
      // A device nobody named is matched by the words about its spot; they often carry the name of the place.
      name: (record.input.nazwa === UNNAMED_PLACE ? record.input.opis_lokalizacji : record.input.nazwa) ?? '',
      street: record.input.nazwa_ulicy ?? '',
      number: record.input.nr_budynku ?? '',
    })
  })
  const { clusters, reviews } = cluster(located)
  if (input.cachedGeo) await addressFromPoint(records.filter(isOsm), input.cachedGeo)

  const context = { sources, existingIds: input.existingIds, today: input.today }
  const aeds = [...clusters, ...unlocated.map((index) => [index])].map((members) => mergeCluster(members.map((index) => records[index]!), context))

  for (const aed of aeds) {
    const before = input.previous.get(aed.id)
    if (before && JSON.stringify({ ...before, data_aktualizacji: '' }) === JSON.stringify({ ...aed.record, data_aktualizacji: '' })) {
      aed.record.data_aktualizacji = before.data_aktualizacji
    }
    for (const ref of aed.sources) {
      const line = reports.get(ref.sourceId)
      if (line) line[aed.publication]++
    }
  }
  for (const line of reports.values()) {
    const own = records.filter((record) => record.sourceId === line.id)
    line.fixes = tally(own.flatMap((record) => record.fixes), () => ({}))
    const severity = new Map(own.flatMap((record) => record.issues).map((issue) => [issue.code, issue.severity]))
    line.issues = tally(own.flatMap((record) => record.issues), (code) => ({ severity: severity.get(code)! }))
    line.coverage = sourceCoverage(sources.get(line.id)!, own)
  }

  return {
    ranAt,
    aeds,
    records,
    reviews: reviews.map((pair) => {
      const a = records[pair.a]!
      const b = records[pair.b]!
      return {
        id: `${memberKey(a)}|${memberKey(b)}`.replaceAll('\u0000', ':'),
        a: { sourceId: a.sourceId, sourceKey: a.sourceKey },
        b: { sourceId: b.sourceId, sourceKey: b.sourceKey },
        score: pair.score,
        distanceM: pair.distanceM,
      }
    }),
    reports: [...reports.values()],
  }
}
