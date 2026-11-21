/**
 * Jobs that change the national dataset. They run inside the API process, one at a time:
 * the database file belongs to this process, and two merges at once would overwrite each other.
 */
import { config, today } from './config'
import { getContext } from './context'
import { enrich } from './pipeline/geocode'
import { runPipeline } from './pipeline/run'
import { loadSourceDefs } from './pipeline/sources'
import type { NormalizedRecord } from './pipeline/types'
import { fetchNotices, osmGapCandidates, procurementCandidates, readNotices } from './radar/build'

export type JobName = 'pipeline' | 'enrich-osm' | 'radar'
export interface JobOptions {
  /** Download fresh copies of the sources first. */
  refresh?: boolean
  /** Skip the registers (tests, or no network). */
  offline?: boolean
}

let running: Promise<unknown> = Promise.resolve()

/** Queues `work` behind the job that is running, so jobs never overlap. */
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = running.then(work, work)
  running = result.catch(() => undefined)
  return result
}

async function pipelineJob(options: JobOptions) {
  const { store, geo, cachedGeo } = await getContext()
  const defs = loadSourceDefs()
  const result = await runPipeline({
    defs,
    stored: await store.storedSources(),
    rawDir: config.rawDir,
    refresh: options.refresh ?? false,
    geo: options.offline ? null : geo,
    cachedGeo,
    existingIds: store.existingIds(),
    previous: store.previousRecords(),
    today: today(),
  })
  await store.savePipeline(result, defs)
  const count = (publication: string) => result.aeds.filter((aed) => aed.publication === publication).length
  return {
    sources: result.reports.map((report) => ({
      id: report.id,
      name: report.name,
      origin: report.origin,
      rows: report.rows,
      official: report.official,
      community: report.community,
      pending: report.pending,
      incomplete: report.incomplete,
      fixes: report.fixes.reduce((sum, line) => sum + line.count, 0) + report.fileFixes.length,
      issues: report.issues.reduce((sum, line) => sum + line.count, 0),
      error: report.error,
    })),
    records: result.records.length,
    devices: result.aeds.length,
    official: count('official'),
    community: count('community'),
    pending: count('pending'),
    incomplete: count('incomplete'),
    mergedDuplicates: result.records.length - result.aeds.length,
    reviewPairs: result.reviews.length,
  }
}

/**
 * Commune codes for the OpenStreetMap layer: one register lookup per point, about 18 thousand of them
 * (roughly 8 minutes the first time, instant afterwards because every answer is cached). Radar needs
 * them to group unconfirmed devices by commune.
 */
async function enrichOsmJob() {
  const { store, geo } = await getContext()
  // Look every point without a code up once; the answers land in the cache that the pipeline reads for OSM.
  const points: NormalizedRecord[] = store.aeds
    .filter((aed) => aed.publication === 'community' && !aed.record.kod_terc)
    .map((aed) => ({
      sourceId: 'osm-pl',
      sourceKey: aed.id,
      input: { szerokosc_geograficzna: aed.record.szerokosc_geograficzna, dlugosc_geograficzna: aed.record.dlugosc_geograficzna },
      raw: {},
      fixes: [],
      issues: [],
    }))
  await enrich(points, geo, { geocodeAddresses: false })
  const resolved = points.filter((point) => point.input.kod_terc).length
  return { lookedUp: points.length, resolved, pipeline: await pipelineJob({}) }
}

/** Rebuilds the Radar leads from the current dataset and the downloaded procurement notices. */
async function radarJob(options: JobOptions) {
  const { store, geo } = await getContext()
  // Notices are downloaded on the first run and with --refresh; otherwise the copies on disk are used.
  const downloaded = config.rawDir && !config.offline && (options.refresh || readNotices(config.rawDir).length === 0) ? await fetchNotices(config.rawDir, today(), !options.refresh) : []
  const gaps = osmGapCandidates(store, today())
  const purchases = await procurementCandidates(store, geo, config.rawDir)
  await store.saveCandidates([...gaps, ...purchases])
  const communes = gaps.filter((candidate) => candidate.kodTerc !== null)
  return {
    leads: store.candidates.length,
    communesWithCommunityDevices: communes.length,
    communesWithNoOfficialRecord: communes.filter((candidate) => candidate.registered === 0).length,
    operators: gaps.length - communes.length,
    procurementNotices: purchases.length,
    noticesDownloaded: downloaded,
    decided: store.candidates.filter((candidate) => candidate.status !== 'new').length,
  }
}

const JOBS: Record<JobName, (options: JobOptions) => Promise<Record<string, unknown>>> = { pipeline: pipelineJob, 'enrich-osm': enrichOsmJob, radar: radarJob }

export function runJob(name: JobName, options: JobOptions = {}): Promise<Record<string, unknown>> {
  return exclusive(() => JOBS[name](options))
}
