/**
 * The feed dane.gov.pl's harvester reads (XML source type, schema version 1.13).
 *
 * The portal has no write API for providers: an administrator registers the feed's address once and the
 * portal then downloads it on a schedule, creating and updating the dataset and its resources by `extIdent`.
 * The XSD (test/fixtures/harvester) is the portal's own; test/pipeline.test.ts validates this output against it.
 *
 * Every provider gets a feed of its own: data published as one dataset under one provider make that provider
 * answerable for all of it (organisers' rule), so the nationwide list is built by the portal, not by us.
 */
import { createHash } from 'node:crypto'

export const HARVESTER_NAMESPACE = 'urn:otwarte-dane:harvester:1.13'

export interface FeedResource {
  /** Stable identifier, at most 36 characters; the portal matches resources by it between downloads. */
  extIdent: string
  /** Must be https: the schema rejects anything else. */
  url: string
  titlePl: string
  titleEn: string
  descriptionPl: string
  descriptionEn: string
}

export interface FeedDataset {
  extIdent: string
  titlePl: string
  titleEn: string
  descriptionPl: string
  descriptionEn: string
  /** Landing page of the dataset outside the portal. */
  url?: string
  licence: 'CC0 1.0' | 'CC BY 4.0'
  /** Free-text conditions of re-use shown next to the licence. */
  conditions: string
  tagsPl: string[]
  tagsEn: string[]
  /** Day the data describe (YYYY-MM-DD) and the moment of the last change (ISO 8601). */
  dataDate: string
  lastUpdate: string
  resources: FeedResource[]
}

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const bilingual = (tag: string, polish: string, english: string, indent: string) =>
  [`${indent}<${tag}>`, `${indent}  <polish>${escape(polish)}</polish>`, `${indent}  <english>${escape(english)}</english>`, `${indent}</${tag}>`].join('\n')

function resourceXml(resource: FeedResource, dataset: FeedDataset): string {
  return [
    '      <resource status="published">',
    `        <extIdent>${escape(resource.extIdent)}</extIdent>`,
    `        <url>${escape(resource.url)}</url>`,
    bilingual('title', resource.titlePl, resource.titleEn, '        '),
    bilingual('description', resource.descriptionPl, resource.descriptionEn, '        '),
    '        <availability>remote</availability>',
    `        <dataDate>${dataset.dataDate}</dataDate>`,
    `        <lastUpdateDate>${dataset.lastUpdate}</lastUpdateDate>`,
    '        <hasDynamicData>false</hasDynamicData>',
    '        <hasHighValueData>false</hasHighValueData>',
    '        <hasHighValueDataFromEuropeanCommissionList>false</hasHighValueDataFromEuropeanCommissionList>',
    '        <hasResearchData>false</hasResearchData>',
    '        <containsProtectedData>false</containsProtectedData>',
    '      </resource>',
  ].join('\n')
}

export function harvesterXml(dataset: FeedDataset): string {
  const tags = [...dataset.tagsPl.map((tag) => `      <tag lang="pl">${escape(tag)}</tag>`), ...dataset.tagsEn.map((tag) => `      <tag lang="en">${escape(tag)}</tag>`)]
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ns2:datasets xmlns:ns2="${HARVESTER_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    '  <dataset status="published">',
    `    <extIdent>${escape(dataset.extIdent)}</extIdent>`,
    bilingual('title', dataset.titlePl, dataset.titleEn, '    '),
    bilingual('description', dataset.descriptionPl, dataset.descriptionEn, '    '),
    ...(dataset.url ? [`    <url>${escape(dataset.url)}</url>`] : []),
    '    <updateFrequency>daily</updateFrequency>',
    '    <hasDynamicData>false</hasDynamicData>',
    '    <hasHighValueData>false</hasHighValueData>',
    '    <hasHighValueDataFromEuropeanCommissionList>false</hasHighValueDataFromEuropeanCommissionList>',
    '    <hasResearchData>false</hasResearchData>',
    '    <categories>',
    '      <category>HEAL</category>',
    '      <category>REGI</category>',
    '    </categories>',
    '    <conditions>',
    '      <source>true</source>',
    '      <modification>true</modification>',
    `      <dbOrCopyrighted>${escape(dataset.conditions)}</dbOrCopyrighted>`,
    `      <dbOrCopyrightedLicenseChosen>${dataset.licence}</dbOrCopyrightedLicenseChosen>`,
    '    </conditions>',
    '    <resources>',
    ...dataset.resources.map((resource) => resourceXml(resource, dataset)),
    '    </resources>',
    '    <tags>',
    ...tags,
    '    </tags>',
    `    <lastUpdateDate>${dataset.lastUpdate}</lastUpdateDate>`,
    '  </dataset>',
    '</ns2:datasets>',
    '',
  ].join('\n')
}

/**
 * The tag that enrols a dataset in the portal's summary list of AEDs ("wykaz zbiorczy", see portal/ in this
 * repository). Tags exist in the admin panel, in the XML feed and in CKAN, so a provider can join without any
 * schema change; the portal then checks the columns of every tagged CSV against the data pattern.
 */
export const WYKAZ_TAG = 'wykaz-aed'

/** Licences the portal's dictionary knows; a source under any other licence cannot be published there. */
export const PORTAL_LICENCES = ['CC0 1.0', 'CC BY 4.0'] as const
export type PortalLicence = (typeof PORTAL_LICENCES)[number]
export const isPortalLicence = (licence: string): licence is PortalLicence => (PORTAL_LICENCES as readonly string[]).includes(licence)

/** extIdent is at most 36 characters; a long source id is shortened to a stable hash. */
function extIdentFor(sourceId: string, suffix: string): string {
  const plain = `aed-${sourceId}${suffix}`
  if (plain.length <= 36) return plain
  return `aed-${createHash('sha1').update(sourceId).digest('hex').slice(0, 36 - 4 - suffix.length)}${suffix}`
}

/**
 * One provider's AEDs as a dataset of that provider. The provider registers this feed in the portal under its own
 * institution, so it stays the one responsible for its devices; the portal merges all providers into one list.
 * `baseUrl` is the public https address of this API.
 */
export function providerFeed(options: {
  baseUrl: string
  landingPage?: string
  source: { id: string; name: string; attribution: string; licence: PortalLicence }
  count: number
  dataDate: string
  lastUpdate: string
}): FeedDataset {
  const base = options.baseUrl.replace(/\/$/, '')
  const { source } = options
  return {
    extIdent: extIdentFor(source.id, ''),
    titlePl: `Defibrylatory AED – ${source.name}`,
    titleEn: `AED defibrillators – ${source.name}`,
    descriptionPl:
      `Publicznie dostępne automatyczne defibrylatory zewnętrzne (AED), za które odpowiada ${source.name}: położenie, dokładne umiejscowienie, ` +
      `godziny i zasady dostępu oraz data ostatniej weryfikacji. Dane mają zakres wzorca danych AED, dlatego portal włącza je do wykazu zbiorczego ` +
      `defibrylatorów z całej Polski (tag „${WYKAZ_TAG}”). Liczba urządzeń: ${options.count}.`,
    descriptionEn:
      `Publicly accessible automated external defibrillators (AED) maintained by ${source.name}: position, exact placement, opening hours, access rules ` +
      `and the date of the last verification. The data follow the AED data pattern, so the portal merges them into the nationwide summary list ` +
      `(tag "${WYKAZ_TAG}"). Number of devices: ${options.count}.`,
    url: options.landingPage,
    licence: source.licence,
    conditions:
      source.licence === 'CC0 1.0'
        ? `Dane można wykorzystywać bez ograniczeń.`
        : `Dane można wykorzystywać bez ograniczeń pod warunkiem podania źródła: ${source.attribution}.`,
    tagsPl: [WYKAZ_TAG, 'AED', 'defibrylator', 'pierwsza pomoc', 'ratownictwo', 'zdrowie'],
    tagsEn: ['AED', 'defibrillator', 'first aid', 'emergency', 'health'],
    dataDate: options.dataDate,
    lastUpdate: options.lastUpdate,
    resources: [
      {
        extIdent: extIdentFor(source.id, '-csv'),
        url: `${base}/v1/sources/${encodeURIComponent(source.id)}/aed.csv`,
        titlePl: `Defibrylatory AED – ${source.name} (CSV)`,
        titleEn: `AED defibrillators – ${source.name} (CSV)`,
        descriptionPl: 'Urządzenia w pliku CSV zgodnym ze wzorcem danych AED (RFC 4180, UTF-8, separator przecinek). Kolumny szerokosc_geograficzna i dlugosc_geograficzna są w układzie WGS84.',
        descriptionEn: 'The devices as a CSV file following the AED data pattern (RFC 4180, UTF-8, comma separated). Coordinates in WGS84.',
      },
    ],
  }
}
