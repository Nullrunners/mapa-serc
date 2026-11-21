/**
 * The feed dane.gov.pl's harvester reads (XML source type, schema version 1.13).
 *
 * The portal has no write API for providers: an administrator registers the feed's address once and the
 * portal then downloads it on a schedule, creating and updating the dataset and its resources by `extIdent`.
 * The XSD (test/fixtures/harvester) is the portal's own; test/publish.test.ts validates this output against it.
 */

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

/** The national AED dataset as the portal should list it. `baseUrl` is the public https address of this API. */
export function nationalFeed(options: { baseUrl: string; landingPage?: string; count: number; attributions: string[]; dataDate: string; lastUpdate: string }): FeedDataset {
  const base = options.baseUrl.replace(/\/$/, '')
  const sources = options.attributions.join('; ')
  return {
    extIdent: 'aed-polska',
    titlePl: 'Lokalizacje defibrylatorów AED w Polsce',
    titleEn: 'Locations of AED defibrillators in Poland',
    descriptionPl:
      `Ogólnopolski zbiór publicznie dostępnych automatycznych defibrylatorów zewnętrznych (AED): położenie, dokładne umiejscowienie, godziny i zasady dostępu, ` +
      `podmiot odpowiedzialny oraz data ostatniej weryfikacji. Zbiór powstaje ze zgłoszeń opiekunów urządzeń i ze zbiorów samorządów; wszystkie rekordy mają ` +
      `jednolity zakres danych (wzorzec danych AED), stały identyfikator i kod TERYT gminy. Liczba urządzeń: ${options.count}. Źródła: ${sources}.`,
    descriptionEn:
      `Nationwide dataset of publicly accessible automated external defibrillators (AED): position, exact placement, opening hours and access rules, ` +
      `responsible entity and the date of the last verification. Built from submissions by device owners and from municipal datasets; every record follows one ` +
      `data pattern and carries a stable identifier and the TERYT code of its commune. Number of devices: ${options.count}.`,
    url: options.landingPage,
    licence: 'CC BY 4.0',
    conditions:
      `Dane można wykorzystywać bez ograniczeń pod warunkiem podania źródła wskazanego w kolumnie „zrodlo" każdego rekordu oraz informacji o przetworzeniu. ` +
      `Licencję rekordu podaje kolumna „licencja". Źródła: ${sources}.`,
    tagsPl: ['AED', 'defibrylator', 'pierwsza pomoc', 'ratownictwo', 'zdrowie', 'bezpieczeństwo'],
    tagsEn: ['AED', 'defibrillator', 'first aid', 'emergency', 'health'],
    dataDate: options.dataDate,
    lastUpdate: options.lastUpdate,
    resources: [
      {
        extIdent: 'aed-polska-csv',
        url: `${base}/dane/aed.csv`,
        titlePl: 'Defibrylatory AED – tabela (CSV)',
        titleEn: 'AED defibrillators – table (CSV)',
        descriptionPl: 'Wszystkie urządzenia w pliku CSV zgodnym ze wzorcem danych AED (RFC 4180, UTF-8, separator przecinek). Kolumny szerokosc_geograficzna i dlugosc_geograficzna są w układzie WGS84.',
        descriptionEn: 'All devices as a CSV file following the AED data pattern (RFC 4180, UTF-8, comma separated). Coordinates in WGS84.',
      },
      {
        extIdent: 'aed-polska-geojson',
        url: `${base}/dane/aed.geojson`,
        titlePl: 'Defibrylatory AED – dane przestrzenne (GeoJSON)',
        titleEn: 'AED defibrillators – spatial data (GeoJSON)',
        descriptionPl: 'Te same urządzenia jako punkty GeoJSON (WGS84), gotowe do wczytania do aplikacji mapowych i systemów GIS.',
        descriptionEn: 'The same devices as GeoJSON points (WGS84), ready for map applications and GIS.',
      },
      {
        extIdent: 'aed-polska-jsonld',
        url: `${base}/dane/aed.jsonld`,
        titlePl: 'Defibrylatory AED – dane połączone (JSON-LD)',
        titleEn: 'AED defibrillators – linked data (JSON-LD)',
        descriptionPl: 'Te same urządzenia opisane słownikiem schema.org w formacie JSON-LD.',
        descriptionEn: 'The same devices described with the schema.org vocabulary as JSON-LD.',
      },
    ],
  }
}
