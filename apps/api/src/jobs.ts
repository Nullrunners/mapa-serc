/**
 * Jobs that change the national dataset. They run inside the API process, one at a time:
 * the database file belongs to this process, and two merges at once would overwrite each other.
 */
import { config, today } from './config'
import { getContext } from './context'
import { addressFromPoint, enrich } from './pipeline/geocode'
import { runPipeline } from './pipeline/run'
import { loadSourceDefs } from './pipeline/sources'
import type { NormalizedRecord } from './pipeline/types'
import { runReminders } from './passport/service'
import { fetchNotices, osmGapCandidates, procurementCandidates, readNotices } from './radar/build'

export type JobName = 'pipeline' | 'enrich-osm' | 'radar' | 'reminders'
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
    secrets: { WARSAW_API_KEY: config.warsawApiKey },
    geo: options.offline ? null : geo,
    cachedGeo,
    existingIds: store.existingIds(),
    previous: store.previousRecords(),
    overrides: store.passportOverrides(),
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
 * Commune codes and addresses for the OpenStreetMap layer: two register lookups per point, about 18 thousand
 * points (minutes the first time, instant afterwards because every answer is cached). Radar needs the codes to
 * group unconfirmed devices by commune; the address is what a device in a place nobody named is called by.
 */
async function enrichOsmJob() {
  const { store, geo } = await getContext()
  // Look every point that lacks something up once; the answers land in the cache that the pipeline reads for OSM.
  const community = store.aeds.filter((aed) => aed.publication === 'community')
  const point = (aed: (typeof community)[number]): NormalizedRecord => ({
    sourceId: 'osm-pl',
    sourceKey: aed.id,
    input: { szerokosc_geograficzna: aed.record.szerokosc_geograficzna, dlugosc_geograficzna: aed.record.dlugosc_geograficzna },
    raw: {},
    fixes: [],
    issues: [],
  })
  const uncoded = community.filter((aed) => !aed.record.kod_terc).map(point)
  await enrich(uncoded, geo, { geocodeAddresses: false })
  const unaddressed = community.filter((aed) => !aed.record.nazwa_ulicy && !aed.record.nr_budynku).map(point)
  await addressFromPoint(unaddressed, geo)
  return {
    lookedUp: uncoded.length,
    resolved: uncoded.filter((record) => record.input.kod_terc).length,
    addressesLookedUp: unaddressed.length,
    addressesFound: unaddressed.filter((record) => record.input.nr_budynku).length,
    pipeline: await pipelineJob({}),
  }
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

/** Expiry reminders for device keepers; safe to run often, a reminder is never sent twice. */
async function remindersJob() {
  const { store } = await getContext()
  return runReminders(store, today())
}

const JOBS: Record<JobName, (options: JobOptions) => Promise<Record<string, unknown>>> = { pipeline: pipelineJob, 'enrich-osm': enrichOsmJob, radar: radarJob, reminders: remindersJob }

export function runJob(name: JobName, options: JobOptions = {}): Promise<Record<string, unknown>> {
  return exclusive(() => JOBS[name](options))
}
