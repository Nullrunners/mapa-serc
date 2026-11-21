/** The national dataset as files: CSV (RFC 4180), GeoJSON and JSON-LD. Pure functions. */
import { csvHeader, type AedRecord } from '@aed/schema'

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/
/** A cell a spreadsheet would run as a formula. Plain signed numbers and phone numbers are harmless. */
const FORMULA = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'string' ? value : String(value)
  // Spreadsheet formula injection: a provider's free text must never execute on a re-user's machine.
  if (FORMULA.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * RFC 4180 as dane.gov.pl's technical standard asks: UTF-8 without BOM, comma, CRLF, one header row,
 * decimal point, ISO 8601 dates, an empty cell for "unknown".
 */
export function toCsv(records: readonly AedRecord[]): string {
  const header = csvHeader()
  const lines = [header.join(',')]
  for (const record of records) lines.push(header.map((name) => csvCell(record[name as keyof AedRecord])).join(','))
  return lines.join('\r\n') + '\r\n'
}

export function toGeoJson(records: readonly AedRecord[]) {
  return {
    type: 'FeatureCollection' as const,
    features: records.map((record) => ({
      type: 'Feature' as const,
      id: record.id,
      geometry: { type: 'Point' as const, coordinates: [record.dlugosc_geograficzna, record.szerokosc_geograficzna] },
      properties: record,
    })),
  }
}

/** schema.org description of each device, for search engines and linked-data users (four-star openness). */
export function toJsonLd(records: readonly AedRecord[], datasetUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': datasetUrl,
    name: 'Lokalizacje defibrylatorów AED w Polsce',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    hasPart: records.map((record) => ({
      '@type': 'Place',
      '@id': `${datasetUrl}#${record.id}`,
      identifier: record.id,
      name: record.nazwa,
      description: record.opis_lokalizacji ?? undefined,
      geo: { '@type': 'GeoCoordinates', latitude: record.szerokosc_geograficzna, longitude: record.dlugosc_geograficzna },
      address: {
        '@type': 'PostalAddress',
        streetAddress: [record.nazwa_ulicy, record.nr_budynku].filter(Boolean).join(' ') || undefined,
        postalCode: record.kod_pocztowy ?? undefined,
        addressLocality: record.miejscowosc,
        addressCountry: 'PL',
      },
      openingHours: record.godziny_dostepnosci ?? undefined,
      telephone: record.telefon_kontaktowy ?? undefined,
      publicAccess: record.dostep === null ? undefined : record.dostep === 'publiczny',
      additionalType: 'https://www.wikidata.org/wiki/Q787407',
    })),
  }
}
