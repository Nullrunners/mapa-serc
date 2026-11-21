/**
 * What one provider publishes in dane.gov.pl under its own institution: its devices in the data pattern (CSV) and
 * a harvester feed that points at that CSV. The provider stays answerable for its own records; the portal merges
 * all providers into the nationwide summary list (portal/ in this repository).
 */
import type { AedRecord } from '@aed/schema'
import { config } from '../config'
import type { Store } from '../db/store'
import type { SourceReport } from '../pipeline/run'
import { isPortalLicence } from './harvester'

/** Devices whose values come from this source: a record built from someone else's data is not theirs to publish. */
export function providerRecords(store: Store, sourceId: string): AedRecord[] {
  return store.aeds
    .filter((aed) => aed.publication !== 'incomplete' && aed.sources.some((ref) => ref.sourceId === sourceId && ref.role === 'values'))
    .map((aed) => aed.record)
    .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl') || a.id.localeCompare(b.id))
}

/** Why a source cannot have a feed for dane.gov.pl, or null when it can. */
export function feedBlocker(report: Pick<SourceReport, 'kind' | 'awaitingApproval' | 'licence'>, devices: number): string | null {
  if (report.kind === 'osm') return 'Dane z OpenStreetMap są na licencji ODbL i nie mają jednego opiekuna, dlatego nie trafiają do portalu.'
  if (report.awaitingApproval) return 'Zgłoszenie czeka na zatwierdzenie przez administratora.'
  if (!isPortalLicence(report.licence)) return `Licencji ${report.licence} nie ma na liście licencji portalu dane.gov.pl.`
  if (devices === 0) return 'W tym źródle nie ma jeszcze urządzeń do opublikowania.'
  return null
}

export const feedUrl = (sourceId: string) => `${config.publicApiUrl}/feeds/dostawcy/${encodeURIComponent(sourceId)}/dane-gov-pl.xml`

/** The feed address of every source that can have one. */
export function feedUrls(store: Store): Map<string, string> {
  const counts = new Map<string, number>()
  for (const aed of store.aeds) {
    if (aed.publication === 'incomplete') continue
    for (const id of new Set(aed.sources.filter((ref) => ref.role === 'values').map((ref) => ref.sourceId))) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return new Map(store.reports.filter((report) => feedBlocker(report, counts.get(report.id) ?? 0) === null).map((report) => [report.id, feedUrl(report.id)]))
}
