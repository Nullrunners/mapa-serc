/** The four official files through the whole pipeline, offline, into an in-memory database and out as files. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { csvHeader, FIELDS, tableSchema } from '@aed/schema'
import { Db } from '../src/db/duck'
import { Store } from '../src/db/store'
import { compare, jaroWinkler, textKey } from '../src/pipeline/dedup'
import { parseDelimited } from '../src/pipeline/parse'
import { runPipeline, type PipelineResult } from '../src/pipeline/run'
import { loadSourceDefs } from '../src/pipeline/sources'
import { csvCell, toCsv, toGeoJson } from '../src/publish/files'
import { harvesterXml, nationalFeed } from '../src/publish/harvester'

const XSD = resolve(import.meta.dirname, 'fixtures/harvester/xml_import_otwarte_dane_1_13.xsd')
const officialDefs = loadSourceDefs().filter((def) => def.id.startsWith('dane-gov-pl-'))

let result: PipelineResult
let store: Store

beforeAll(async () => {
  store = new Store(await Db.open(':memory:'))
  await store.load()
  result = await runPipeline({ defs: officialDefs, stored: [], rawDir: null, refresh: false, geo: null, cachedGeo: null, existingIds: new Map(), previous: new Map(), today: '2026-11-21' })
  await store.savePipeline(result, officialDefs)
})

describe('pipeline on the official files', () => {
  it('publishes every row that has a position', () => {
    expect(result.records).toHaveLength(74)
    const official = result.aeds.filter((aed) => aed.publication === 'official')
    const incomplete = result.aeds.filter((aed) => aed.publication === 'incomplete')
    // Offline, the Marki row with coordinates pasted from Krosno has no position: it waits for the geocoder.
    expect(incomplete.map((aed) => aed.record.nazwa)).toEqual(['Szkoła Podstawowa nr 5'])
    expect(official).toHaveLength(73)
    expect(new Set(result.aeds.map((aed) => aed.id)).size).toBe(74)
  })

  it('carries licence and attribution per record', () => {
    const marki = result.aeds.find((aed) => aed.record.nazwa === 'Urząd Miasta Marki')!
    expect(marki.record).toMatchObject({ licencja: 'CC BY 4.0', zrodlo: 'Urząd Miasta Marki (dane.gov.pl, zbiór 4955)', status: 'nieznany', kod_terc: '1434021' })
    expect(marki.provenance.nazwa).toBe('dane-gov-pl-68353')
    const krosno = result.aeds.find((aed) => aed.record.nazwa === 'Urząd Miasta Krosna')!
    expect(krosno.record.licencja).toBe('CC0 1.0')
  })

  it('reports to each provider what was repaired', () => {
    const marki = result.reports.find((report) => report.name === 'Urząd Miasta Marki')!
    expect(marki).toMatchObject({ rows: 8, official: 7, incomplete: 1, origin: 'fixture' })
    expect(marki.fileFixes.map((fix) => fix.code)).toContain('whole_line_quoted')
    expect(marki.fixes.find((line) => line.code === 'coordinates_swapped')!.count).toBe(7)
    expect(marki.issues.map((line) => line.code)).toEqual(expect.arrayContaining(['address_point_mismatch', 'coordinates_duplicate_in_source']))
    const legionowo = result.reports.find((report) => report.name === 'Urząd Miasta Legionowo')!
    expect(legionowo).toMatchObject({ rows: 24, official: 24, fixes: [], issues: [] })
  })

  it('keeps ids and update dates stable across runs and restarts', async () => {
    const again = await runPipeline({
      defs: officialDefs,
      stored: [],
      rawDir: null,
      refresh: false,
      geo: null,
      cachedGeo: null,
      existingIds: store.existingIds(),
      previous: store.previousRecords(),
      today: '2026-12-24',
    })
    expect(again.aeds.map((aed) => aed.id).sort()).toEqual(result.aeds.map((aed) => aed.id).sort())
    expect(new Set(again.aeds.map((aed) => aed.record.data_aktualizacji))).toEqual(new Set(['2026-11-21']))

    // Radar labels a commune by its own name, which only the registers cache knows.
    await store.geoCache().set('uldk:50.03000,21.47000', { terc: '1803042', gmina: 'Dębica (gmina wiejska)', powiat: 'dębicki', wojewodztwo: 'podkarpackie' })

    const reopened = new Store((store as unknown as { db: Db }).db)
    await reopened.load()
    expect(reopened.communeNames().get('1803042')).toBe('Dębica')
    expect(reopened.aeds).toHaveLength(74)
    expect(reopened.official()).toHaveLength(73)
    expect(reopened.reports).toHaveLength(4)
  })
})

describe('deduplication', () => {
  const base = { index: 0, sourceId: 'a', priority: 80, lat: 52.326697, lon: 21.107557, name: 'Urząd Miasta Marki', street: 'Piłsudskiego', number: '95' }

  it('merges the same place seen by two sources', () => {
    const osm = { ...base, index: 1, sourceId: 'osm', priority: 40, lat: 52.32675, lon: 21.10761, name: 'Urząd Miasta Marki', street: '', number: '' }
    expect(compare(base, osm).decision).toBe('auto')
  })

  it('keeps two devices on one street apart', () => {
    const other = { ...base, index: 1, sourceId: 'b', lat: 52.3272, lon: 21.1069, name: 'Szkoła Podstawowa nr 1', street: 'Piłsudskiego', number: '77' }
    expect(compare(base, other).decision).not.toBe('auto')
  })

  it('sends a near, differently named place to review', () => {
    const vague = { ...base, index: 1, sourceId: 'osm', priority: 40, lat: 52.32672, lon: 21.10758, name: 'Na ścianie przy wejściu', street: '', number: '' }
    expect(compare(base, vague).decision).toBe('review')
  })

  it('compares names without diacritics and filler words', () => {
    expect(textKey('Defibrylator AED – Urząd Miasta Łódź')).toBe('urzad miasta lodz')
    expect(jaroWinkler('urzad miasta marki', 'urzad miasta marki')).toBe(1)
    expect(jaroWinkler('urzad miasta marki', 'szkola podstawowa')).toBeLessThan(0.6)
  })
})

describe('files for dane.gov.pl', () => {
  it('writes RFC 4180 CSV that follows the pattern', () => {
    const csv = toCsv(store.official())
    expect(csv.startsWith(csvHeader().join(',') + '\r\n')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
    const rows = parseDelimited(csv, ',')
    expect(rows).toHaveLength(74)
    expect(rows.every((row) => row.length === FIELDS.length)).toBe(true)

    // Every cell satisfies the Table Schema generated from the same catalogue.
    const schema = tableSchema()
    const header = rows[0]!
    for (const row of rows.slice(1)) {
      schema.fields.forEach((field, index) => {
        const cell = row[index]!
        const constraints = (field.constraints ?? {}) as { required?: boolean; enum?: string[]; pattern?: string; minimum?: number; maximum?: number }
        if (cell === '') return void expect(constraints.required, `${header[index]} is required`).toBeFalsy()
        if (constraints.enum) expect(constraints.enum).toContain(cell)
        if (constraints.pattern) expect(cell).toMatch(new RegExp(constraints.pattern))
        if (field.type === 'number') {
          expect(cell).toMatch(/^-?\d+(\.\d+)?$/)
          expect(Number(cell)).toBeGreaterThanOrEqual(constraints.minimum!)
          expect(Number(cell)).toBeLessThanOrEqual(constraints.maximum!)
        }
        if (field.type === 'date') expect(cell).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })
    }
  })

  it('neutralises spreadsheet formulas but leaves numbers and phones alone', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
    expect(csvCell('+48227667200')).toBe('+48227667200')
    expect(csvCell(-1.5)).toBe('-1.5')
    expect(csvCell('Parter, przy portierni')).toBe('"Parter, przy portierni"')
    expect(csvCell(null)).toBe('')
  })

  it('writes GeoJSON with longitude first', () => {
    const geojson = toGeoJson(store.official())
    const office = geojson.features.find((feature) => feature.properties.nazwa === 'Urząd Miasta Legionowo')!
    expect(office.geometry.coordinates).toEqual([20.931382, 52.395198])
  })

  it('writes a harvester feed that the portal schema accepts', () => {
    const official = store.official()
    const xml = harvesterXml(
      nationalFeed({
        baseUrl: 'https://api.aed.example.gov.pl',
        landingPage: 'https://aed.example.gov.pl',
        count: official.length,
        attributions: [...new Set(official.map((record) => record.zrodlo))],
        dataDate: '2026-11-21',
        lastUpdate: '2026-11-21T10:00:00.000Z',
      }),
    )
    const file = join(mkdtempSync(join(tmpdir(), 'aed-feed-')), 'feed.xml')
    writeFileSync(file, xml)
    // xmllint exits non-zero and prints the violations when the document does not match the XSD.
    const output = execFileSync('xmllint', ['--noout', '--schema', XSD, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(output).toBe('')
    expect(xml).toContain('<dbOrCopyrightedLicenseChosen>CC BY 4.0</dbOrCopyrightedLicenseChosen>')
    expect(xml).toContain('<url>https://api.aed.example.gov.pl/dane/aed.csv</url>')
  })
})
