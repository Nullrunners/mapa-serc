/**
 * Application state: the national dataset in memory (requests are answered from here) and its copy in DuckDB
 * (so a restart continues where it stopped). Everything that changes state goes through this file.
 */
import type { AedRecord } from '@aed/schema'
import { communeName, type Commune, type GeoCache } from '../pipeline/geocode'
import { memberKey, type MergedAed } from '../pipeline/merge'
import type { PipelineResult, ReviewPair, SourceReport, StoredSource } from '../pipeline/run'
import type { NormalizedRecord, SourceDef } from '../pipeline/types'
import type { Candidate, CandidateStatus } from '../radar/build'
import type { Db, Param } from './duck'

const json = (value: unknown): string => JSON.stringify(value)
const parse = <T>(text: unknown): T => JSON.parse(String(text)) as T

export interface ChangeLogEntry {
  at: string
  actor: string
  entity: string
  entityId: string
  action: string
  detail: unknown
}

export class Store {
  aeds: MergedAed[] = []
  private byId = new Map<string, MergedAed>()
  reports: SourceReport[] = []
  reviews: ReviewPair[] = []
  /** When the pipeline last ran; null before the first run. */
  ranAt: string | null = null
  /** Radar leads, as built by the last radar job, with the operator's decisions. */
  candidates: Candidate[] = []
  private links = new Map<string, string>()
  private geocodes = new Map<string, unknown>()

  constructor(private readonly db: Db) {}

  /** Reads the last persisted state. An empty database is a valid state: the first pipeline run fills it. */
  async load(): Promise<void> {
    const rows = await this.db.all<Record<string, unknown>>('SELECT id, publication, quality, record, provenance, sources, issues FROM aed')
    this.setAeds(
      rows.map((row) => ({
        id: String(row.id),
        publication: row.publication as MergedAed['publication'],
        quality: Number(row.quality),
        record: parse<AedRecord>(row.record),
        provenance: parse(row.provenance),
        sources: parse(row.sources),
        issues: parse(row.issues),
      })),
    )
    // A report written before the data scope existed has no `coverage`; the next pipeline run fills it.
    this.reports = (await this.db.all<{ report: string | null }>('SELECT report FROM sources WHERE report IS NOT NULL')).map((row) => {
      const report = parse<SourceReport>(row.report)
      return { ...report, coverage: report.coverage ?? [] }
    })
    this.reviews = (await this.db.all<{ id: string; a: string; b: string; score: number; distance_m: number }>('SELECT id, a, b, score, distance_m FROM review_pairs WHERE decision IS NULL')).map(
      (row) => ({ id: row.id, a: parse(row.a), b: parse(row.b), score: Number(row.score), distanceM: Number(row.distance_m) }),
    )
    for (const row of await this.db.all<{ source_id: string; source_key: string; aed_id: string }>('SELECT source_id, source_key, aed_id FROM aed_links')) {
      this.links.set(memberKey({ sourceId: row.source_id, sourceKey: row.source_key }), row.aed_id)
    }
    for (const row of await this.db.all<{ key: string; result: string }>('SELECT key, result FROM geocode_cache')) this.geocodes.set(row.key, parse(row.result))
    this.ranAt = (await this.db.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'ran_at'`))[0]?.value ?? null
    this.candidates = (await this.db.all<{ document: string; status: string }>('SELECT document, status FROM candidates')).map((row) => ({
      ...parse<Candidate>(row.document),
      status: row.status as CandidateStatus,
    }))
  }

  /** Replaces the leads with a fresh build; a lead the operator already decided on keeps its status. */
  async saveCandidates(built: Candidate[]): Promise<void> {
    const decided = new Map(this.candidates.filter((candidate) => candidate.status !== 'new').map((candidate) => [candidate.id, candidate.status]))
    const candidates = built.map((candidate) => ({ ...candidate, status: decided.get(candidate.id) ?? candidate.status }))
    const at = new Date().toISOString()
    await this.db.replace('candidates', ['id', 'kind', 'status', 'document', 'updated_at'], candidates.map((candidate) => [candidate.id, candidate.kind, candidate.status, json(candidate), at]), {
      sql: 'DELETE FROM candidates',
    })
    this.candidates = candidates
  }

  async setCandidateStatus(id: string, status: CandidateStatus): Promise<Candidate | undefined> {
    const candidate = this.candidates.find((item) => item.id === id)
    if (!candidate) return undefined
    candidate.status = status
    await this.db.run('UPDATE candidates SET status = ?, document = ?, updated_at = ? WHERE id = ?', [status, json(candidate), new Date().toISOString(), id])
    return candidate
  }

  private setAeds(aeds: MergedAed[]): void {
    this.aeds = aeds
    this.byId = new Map(aeds.map((aed) => [aed.id, aed]))
  }

  get(id: string): MergedAed | undefined {
    return this.byId.get(id)
  }

  /** Records that go into the file for dane.gov.pl. */
  official(): AedRecord[] {
    return this.aeds.filter((aed) => aed.publication === 'official').map((aed) => aed.record)
  }

  existingIds(): Map<string, string> {
    return new Map(this.links)
  }

  previousRecords(): Map<string, AedRecord> {
    return new Map(this.aeds.map((aed) => [aed.id, aed.record]))
  }

  /** Sources kept in the database (uploads, owner submissions) with their records. */
  async storedSources(): Promise<StoredSource[]> {
    const defs = (await this.db.all<{ def: string }>(`SELECT def FROM sources WHERE kind IN ('upload', 'owner')`)).map((row) => parse<SourceDef>(row.def))
    const stored: StoredSource[] = []
    for (const def of defs) {
      const rows = await this.db.all<Record<string, string>>('SELECT source_key, input, raw, fixes, issues FROM source_records WHERE source_id = ?', [def.id])
      stored.push({
        def,
        records: rows.map((row) => ({ sourceId: def.id, sourceKey: row.source_key!, input: parse(row.input), raw: parse(row.raw), fixes: parse(row.fixes), issues: parse(row.issues) })),
      })
    }
    return stored
  }

  /** Adds or replaces a database-kept source; the next pipeline run merges it into the national dataset. */
  async saveStoredSource(def: SourceDef, records: NormalizedRecord[]): Promise<void> {
    await this.db.replace('sources', ['id', 'kind', 'def', 'report', 'updated_at'], [[def.id, def.kind, json(def), null, new Date().toISOString()]], {
      sql: 'DELETE FROM sources WHERE id = ?',
      params: [def.id],
    })
    await this.db.replace('source_records', ['source_id', 'source_key', 'input', 'raw', 'fixes', 'issues'], records.map(recordRow), {
      sql: 'DELETE FROM source_records WHERE source_id = ?',
      params: [def.id],
    })
  }

  /** Definition of a database-kept source, or undefined when there is none with this id. */
  async storedDef(id: string): Promise<SourceDef | undefined> {
    const row = (await this.db.all<{ def: string }>(`SELECT def FROM sources WHERE id = ? AND kind IN ('upload', 'owner')`, [id]))[0]
    return row ? parse<SourceDef>(row.def) : undefined
  }

  /** Marks a submission as approved; the next pipeline run publishes its records. */
  async approveSource(id: string): Promise<boolean> {
    const def = await this.storedDef(id)
    if (!def) return false
    await this.db.run('UPDATE sources SET def = ? WHERE id = ?', [json({ ...def, pending: false }), id])
    return true
  }

  /** Persists a pipeline run and makes it the state requests are answered from. */
  async savePipeline(result: PipelineResult, fileDefs: SourceDef[]): Promise<void> {
    const fileIds = new Set(fileDefs.map((def) => def.id))
    const defs = new Map(fileDefs.map((def) => [def.id, def]))

    // File sources are rewritten whole; database-kept sources only get their report refreshed.
    for (const report of result.reports) {
      if (fileIds.has(report.id)) {
        await this.db.replace('sources', ['id', 'kind', 'def', 'report', 'updated_at'], [[report.id, report.kind, json(defs.get(report.id)), json(report), result.ranAt]], {
          sql: 'DELETE FROM sources WHERE id = ?',
          params: [report.id],
        })
        await this.db.replace(
          'source_records',
          ['source_id', 'source_key', 'input', 'raw', 'fixes', 'issues'],
          result.records.filter((record) => record.sourceId === report.id).map(recordRow),
          { sql: 'DELETE FROM source_records WHERE source_id = ?', params: [report.id] },
        )
      } else {
        await this.db.run('UPDATE sources SET report = ?, updated_at = ? WHERE id = ?', [json(report), result.ranAt, report.id])
      }
    }

    await this.db.replace(
      'aed',
      ['id', 'publication', 'lat', 'lon', 'kod_terc', 'quality', 'record', 'provenance', 'sources', 'issues'],
      result.aeds.map((aed) => [
        aed.id,
        aed.publication,
        aed.record.szerokosc_geograficzna ?? null,
        aed.record.dlugosc_geograficzna ?? null,
        aed.record.kod_terc ?? null,
        aed.quality,
        json(aed.record),
        json(aed.provenance),
        json(aed.sources),
        json(aed.issues),
      ]),
      { sql: 'DELETE FROM aed' },
    )

    const links = result.aeds.flatMap((aed) => aed.sources.map((ref): Param[] => [ref.sourceId, ref.sourceKey, aed.id]))
    await this.db.replace('aed_links', ['source_id', 'source_key', 'aed_id'], links, { sql: 'DELETE FROM aed_links' })

    await this.db.replace(
      'review_pairs',
      ['id', 'a', 'b', 'score', 'distance_m', 'decision'],
      result.reviews.map((pair) => [pair.id, json(pair.a), json(pair.b), pair.score, pair.distanceM, null]),
      { sql: 'DELETE FROM review_pairs WHERE decision IS NULL' },
    )
    await this.db.replace('meta', ['key', 'value'], [['ran_at', result.ranAt]], { sql: `DELETE FROM meta WHERE key = 'ran_at'` })

    this.setAeds(result.aeds)
    this.reports = result.reports
    this.reviews = result.reviews
    this.ranAt = result.ranAt
    this.links = new Map(links.map(([sourceId, sourceKey, id]) => [memberKey({ sourceId: String(sourceId), sourceKey: String(sourceKey) }), String(id)]))
  }

  /** TERC → name of the commune, for every commune one of our points was looked up in. */
  communeNames(): Map<string, string> {
    const names = new Map<string, string>()
    for (const [key, value] of this.geocodes) {
      const commune = key.startsWith('uldk:') ? (value as Commune | null) : null
      if (commune) names.set(commune.terc, communeName(commune.gmina))
    }
    return names
  }

  /** Register answers, remembered across runs and restarts. */
  geoCache(): GeoCache {
    return {
      get: async (key) => this.geocodes.get(key),
      set: async (key, value) => {
        this.geocodes.set(key, value)
        await this.db.run('INSERT INTO geocode_cache (key, result) VALUES (?, ?)', [key, json(value)])
      },
    }
  }

  async log(entry: Omit<ChangeLogEntry, 'at'>): Promise<void> {
    await this.db.run('INSERT INTO change_log (logged_at, actor, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)', [
      new Date().toISOString(),
      entry.actor,
      entry.entity,
      entry.entityId,
      entry.action,
      json(entry.detail),
    ])
  }

  async history(entityId: string): Promise<ChangeLogEntry[]> {
    const rows = await this.db.all<Record<string, string>>('SELECT logged_at, actor, entity, entity_id, action, detail FROM change_log WHERE entity_id = ? ORDER BY logged_at DESC', [entityId])
    return rows.map((row) => ({ at: row.logged_at!, actor: row.actor!, entity: row.entity!, entityId: row.entity_id!, action: row.action!, detail: parse(row.detail) }))
  }
}

const recordRow = (record: NormalizedRecord): Param[] => [record.sourceId, record.sourceKey, json(record.input), json(record.raw), json(record.fixes), json(record.issues)]
