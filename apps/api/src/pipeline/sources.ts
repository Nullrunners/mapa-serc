/**
 * Source definitions (apps/api/sources/*.json), reading a source's file and turning it into normalised records.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { UNNAMED_PLACE } from '@aed/schema'
import { distanceM, normalizeRow } from './normalize'
import { parseCsv, parseGeoJson } from './parse'
import type { Fix, NormalizedRecord, RawTable, SourceDef } from './types'

const API_ROOT = resolve(import.meta.dirname, '../..')
export const SOURCES_DIR = join(API_ROOT, 'sources')
export const FIXTURES_DIR = join(API_ROOT, 'test/fixtures/sources')

/** Every *.json in apps/api/sources, in file-name order. */
export function loadSourceDefs(): SourceDef[] {
  return readdirSync(SOURCES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(SOURCES_DIR, file), 'utf8')) as SourceDef)
}

export type Origin = 'network' | 'snapshot' | 'fixture'

const snapshotPath = (def: SourceDef, rawDir: string) => join(rawDir, def.snapshot ?? `${def.id}.${def.format}`)

/** `{NAME}` in a source address stands for a secret (an API key) that only the running service knows. */
const SECRET = /\{([A-Z][A-Z0-9_]*)\}/

/** The address as it may be shown and stored: query parameters that carry a secret are left out. */
export function publicUrl(def: SourceDef): string {
  const at = def.url.indexOf('?')
  if (at < 0) return def.url
  const kept = def.url
    .slice(at + 1)
    .split('&')
    .filter((parameter) => !SECRET.test(parameter))
  return kept.length > 0 ? `${def.url.slice(0, at)}?${kept.join('&')}` : def.url.slice(0, at)
}

/** The address to download from, or the name of the secret it needs and was not given. */
function downloadUrl(def: SourceDef, secrets: Record<string, string>): { url: string } | { missing: string } {
  let missing: string | undefined
  const url = def.url.replace(new RegExp(SECRET, 'g'), (_match, name: string) => {
    const value = secrets[name] ?? ''
    if (value === '') missing ??= name
    return encodeURIComponent(value)
  })
  return missing ? { missing } : { url }
}

/** An error text must never carry a secret, whatever the network layer chose to put in it. */
const withoutSecrets = (text: string, secrets: Record<string, string>) =>
  Object.values(secrets)
    .filter((value) => value !== '')
    .reduce((result, value) => result.replaceAll(value, '…').replaceAll(encodeURIComponent(value), '…'), text)

/**
 * The file of a source. With `refresh` it is downloaded and the copy under `rawDir` replaced; a failed download
 * falls back to the last copy, and a source that was never downloaded to its frozen fixture. Returns null when
 * there is nothing to read (e.g. OSM before the first download). A source whose address needs a secret that
 * was not given is not downloaded at all.
 */
export async function readSourceBytes(
  def: SourceDef,
  options: { rawDir: string | null; refresh: boolean; secrets?: Record<string, string> },
): Promise<{ bytes: Uint8Array; origin: Origin; error?: string } | null> {
  const snapshot = options.rawDir ? snapshotPath(def, options.rawDir) : null
  const secrets = options.secrets ?? {}
  let error: string | undefined
  if (options.refresh) {
    const target = downloadUrl(def, secrets)
    if ('missing' in target) {
      error = `Nie pobrano świeżej kopii: brakuje klucza dostępu do tego źródła (${target.missing}).`
    } else {
      try {
        const response = await fetch(target.url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'aed-hub/0.1' } })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (snapshot) {
          mkdirSync(dirname(snapshot), { recursive: true })
          writeFileSync(snapshot, bytes)
        }
        return { bytes, origin: 'network' }
      } catch (cause) {
        error = withoutSecrets(cause instanceof Error ? cause.message : String(cause), secrets)
      }
    }
  }
  if (snapshot && existsSync(snapshot)) return { bytes: readFileSync(snapshot), origin: 'snapshot', error }
  const fixture = def.fixture ? join(FIXTURES_DIR, def.fixture) : null
  if (fixture && existsSync(fixture)) return { bytes: readFileSync(fixture), origin: 'fixture', error }
  return null
}

export function parseSource(def: SourceDef, bytes: Uint8Array): RawTable {
  if (def.format === 'xlsx' || def.format === 'xls') throw new Error('A workbook is read only when it is uploaded through the wizard; a file source must be CSV or GeoJSON.')
  return def.format === 'geojson' ? parseGeoJson(bytes) : parseCsv(bytes)
}

const derivedKey = (parts: unknown[]) => createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 12)

/** Applies the source's reviewed mapping to every row. */
export function normalizeSource(def: SourceDef, table: RawTable): NormalizedRecord[] {
  const strips = (def.strip ?? []).map((rule) => ({ column: rule.column, pattern: new RegExp(rule.pattern, 'i') }))
  const extracts = (def.extract ?? []).map((rule) => ({ ...rule, pattern: new RegExp(rule.pattern, 'i') }))
  const seen = new Map<string, number>()

  return table.rows.map((original) => {
    const row = { ...original }
    const mapping = { ...def.mapping }
    for (const rule of extracts) {
      const match = (original[rule.from] ?? '').match(rule.pattern)
      const column = `@extract:${rule.to}`
      row[column] = match?.[1] ?? ''
      mapping[column] = rule.to
    }
    for (const rule of strips) row[rule.column] = (row[rule.column] ?? '').replace(rule.pattern, '').trim()

    const nameColumn = Object.entries(def.mapping).find(([, target]) => target === 'nazwa')?.[0]
    if (def.fallbackName && !(nameColumn && row[nameColumn])) {
      // A tag that holds only punctuation (".", "-") is no name, and a leading dash is a list marker left in the tag.
      const fallback = def.fallbackName.map((column) => (row[column] ?? '').replace(/^[\s\-–—.,;:*]+/, '')).find((value) => /\p{L}/u.test(value))
      row['@name'] = (fallback ?? UNNAMED_PLACE).slice(0, 200)
      mapping['@name'] = 'nazwa'
    }

    const { input, fixes, issues } = normalizeRow(row, mapping, def.defaults)

    let sourceKey = (def.keyColumn ? original[def.keyColumn] : '') || derivedKey([input.nazwa, input.nazwa_ulicy, input.nr_budynku, input.miejscowosc])
    // Two rows with the same key would overwrite each other; keep both and make the second distinguishable.
    const count = (seen.get(sourceKey) ?? 0) + 1
    seen.set(sourceKey, count)
    if (count > 1) sourceKey = `${sourceKey}#${count}`

    return { sourceId: def.id, sourceKey, input, raw: original, fixes: [...fixes] as Fix[], issues }
  })
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * An office's list often names the town in some rows only ("ul. Paradna 36, 93-345 Łódź", then "ul. Wileńska 25").
 * When nearly every row that names a town names the same one (a typo in one row must not spoil it), a row with
 * a street and a number but no town is taken to be there too. The address register then has the last word:
 * an address it does not know gets no position.
 */
function fillTown(def: SourceDef, records: NormalizedRecord[]): void {
  if (def.kind === 'osm') return
  const counts = new Map<string, number>()
  for (const record of records) if (record.input.miejscowosc) counts.set(record.input.miejscowosc, (counts.get(record.input.miejscowosc) ?? 0) + 1)
  const named = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const [town, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  if (named < 5 || count < named * 0.9) return
  for (const record of records) {
    if (record.input.miejscowosc || !record.input.nazwa_ulicy || !record.input.nr_budynku) continue
    record.input.miejscowosc = town
    record.fixes.push({ code: 'locality_from_file', field: 'miejscowosc', message: `W wierszu nie było miejscowości; przyjęto „${town}", bo tę miejscowość podają pozostałe wiersze pliku.`, after: town })
  }
}

/**
 * Checks that only make sense across a whole source:
 *  - a row without a town in a list where every other row names the same town,
 *  - a point far away from all the others of a single-municipality source (a row pasted from another file),
 *  - two devices with identical coordinates but different addresses.
 * A far-away point loses its coordinates, so that the address is geocoded instead of trusting it.
 */
export function checkSource(def: SourceDef, records: NormalizedRecord[]): void {
  fillTown(def, records)
  const located = records.filter((record) => record.input.szerokosc_geograficzna != null && record.input.dlugosc_geograficzna != null)

  if (def.kind !== 'osm' && located.length >= 5) {
    const lat = median(located.map((record) => record.input.szerokosc_geograficzna!))
    const lon = median(located.map((record) => record.input.dlugosc_geograficzna!))
    const distances = located.map((record) => distanceM(lat, lon, record.input.szerokosc_geograficzna!, record.input.dlugosc_geograficzna!))
    const compact = distances.filter((distance) => distance <= 30_000).length >= located.length * 0.8
    if (compact) {
      located.forEach((record, index) => {
        const distance = distances[index]!
        if (distance <= 50_000) return
        const before = `${record.input.szerokosc_geograficzna}; ${record.input.dlugosc_geograficzna}`
        record.issues.push({
          code: 'address_point_mismatch',
          severity: 'warning',
          field: 'szerokosc_geograficzna',
          message: `Współrzędne (${before}) wskazują punkt ${Math.round(distance / 1000)} km od pozostałych urządzeń tego dostawcy; odrzucono je i system ustali położenie z adresu.`,
        })
        delete record.input.szerokosc_geograficzna
        delete record.input.dlugosc_geograficzna
      })
    }
  }

  const byPoint = new Map<string, NormalizedRecord[]>()
  for (const record of records) {
    if (record.input.szerokosc_geograficzna == null) continue
    const point = `${record.input.szerokosc_geograficzna},${record.input.dlugosc_geograficzna}`
    byPoint.set(point, [...(byPoint.get(point) ?? []), record])
  }
  for (const group of byPoint.values()) {
    const addresses = new Set(group.map((record) => `${record.input.nazwa_ulicy ?? ''} ${record.input.nr_budynku ?? ''}`.trim()))
    if (def.kind === 'osm' || group.length < 2 || addresses.size < 2) continue
    for (const record of group) {
      record.issues.push({
        code: 'coordinates_duplicate_in_source',
        severity: 'warning',
        field: 'szerokosc_geograficzna',
        message: `${group.length} urządzenia mają identyczne współrzędne, a różne adresy (${[...addresses].join('; ')}). Sprawdź, które położenie jest właściwe.`,
      })
    }
  }
}
