/** A city that serves its list through an API with a key (Warsaw), and the words such a list is written in. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cluster, compare, type DedupItem } from '../src/pipeline/dedup'
import { parseIndoor, parseOpeningHours } from '../src/pipeline/normalize'
import { parseAny, parseGeoJson } from '../src/pipeline/parse'
import { checkSource, loadSourceDefs, normalizeSource, parseSource, publicUrl, readSourceBytes } from '../src/pipeline/sources'
import type { SourceDef } from '../src/pipeline/types'

const warsaw = loadSourceDefs().find((def) => def.id === 'um-warszawa')!

describe('Warsaw', () => {
  it('reads the list the city API wraps in `result`, with the point nested one level too deep', () => {
    const answer = { result: [{ geometry: { type: 'Point', coordinates: [[21.0148, 52.2086]] }, properties: { defibrillator_id: '622', location_city: 'Warszawa' } }] }
    expect(parseGeoJson(JSON.stringify(answer)).rows).toEqual([{ '@lon': '21.0148', '@lat': '52.2086', defibrillator_id: '622', location_city: 'Warszawa' }])
  })

  it('maps the frozen copy onto the pattern', async () => {
    const file = await readSourceBytes(warsaw, { rawDir: null, refresh: false })
    expect(file!.origin).toBe('fixture')
    const records = normalizeSource(warsaw, parseSource(warsaw, file!.bytes))
    checkSource(warsaw, records)

    expect(records).toHaveLength(708)
    expect(new Set(records.map((record) => record.sourceKey)).size).toBe(708)
    expect(records.flatMap((record) => record.issues).filter((issue) => issue.severity === 'error')).toEqual([])
    expect(records.every((record) => record.input.szerokosc_geograficzna! > 52 && record.input.szerokosc_geograficzna! < 52.5)).toBe(true)
    expect(records.every((record) => record.input.dlugosc_geograficzna! > 20.7 && record.input.dlugosc_geograficzna! < 21.4)).toBe(true)

    const office = records.find((record) => record.sourceKey === '622')!
    expect(office.input).toMatchObject({
      nazwa: 'Urząd Dzielnicy Mokotów m.st. Warszawy',
      nazwa_ulicy: 'Rakowiecka',
      nr_budynku: '25/27',
      kod_pocztowy: '02-517',
      miejscowosc: 'Warszawa',
      szerokosc_geograficzna: 52.2086171,
      dlugosc_geograficzna: 21.0148749,
      opis_lokalizacji: 'Przy wejściu na półpiętrze.',
      wewnatrz_budynku: true,
      dostep: 'publiczny',
      godziny_dostepnosci: 'Mo 08:00-18:00; Tu-Fr 08:00-16:00',
      producent: 'Medtronic',
      status: 'czynny',
      id_w_zrodle: '622',
    })
  })

  it('keeps hours it cannot read as words for the rescuer instead of guessing', async () => {
    const file = await readSourceBytes(warsaw, { rawDir: null, refresh: false })
    const records = normalizeSource(warsaw, parseSource(warsaw, file!.bytes))
    const metro = records.find((record) => record.raw.device_access_description === 'W godzinach otwarcia stacji metra')!
    expect(metro.input.godziny_dostepnosci).toBeUndefined()
    expect(metro.input.uwagi_dostepu).toBe('Godziny: W godzinach otwarcia stacji metra')
    // The city's "availability: yes" is not "round the clock" (a museum has it too), so no hours come from it.
    const noWords = records.filter((record) => !record.raw.device_access_description)
    expect(noWords.length).toBeGreaterThan(0)
    expect(noWords.every((record) => record.input.godziny_dostepnosci === undefined)).toBe(true)
  })
})

describe('a source behind an API key', () => {
  const def: SourceDef = { ...warsaw, fixture: undefined, url: 'https://example.test/api/?id=1&apikey={CITY_KEY}' }
  afterEach(() => vi.unstubAllGlobals())

  it('never shows the key parameter', () => {
    expect(publicUrl(def)).toBe('https://example.test/api/?id=1')
    expect(publicUrl({ ...def, url: 'https://example.test/api?key={CITY_KEY}' })).toBe('https://example.test/api')
    expect(publicUrl({ ...def, url: 'https://example.test/file.csv' })).toBe('https://example.test/file.csv')
    expect(publicUrl(warsaw)).not.toContain('apikey')
  })

  it('downloads with the key in place', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: unknown) => {
      asked.push(String(url))
      return new Response('{"result":[]}')
    })
    const file = await readSourceBytes(def, { rawDir: null, refresh: true, secrets: { CITY_KEY: 's3cret/value' } })
    expect(asked).toEqual(['https://example.test/api/?id=1&apikey=s3cret%2Fvalue'])
    expect(file).toMatchObject({ origin: 'network' })
  })

  it('does not download without the key, says why and reads the copy it has', async () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    const file = await readSourceBytes(warsaw, { rawDir: null, refresh: true, secrets: { WARSAW_API_KEY: '' } })
    expect(fetched).not.toHaveBeenCalled()
    expect(file).toMatchObject({ origin: 'fixture' })
    expect(file!.error).toContain('WARSAW_API_KEY')
  })

  it('removes the key from an error the network layer reports', async () => {
    vi.stubGlobal('fetch', async (url: unknown) => {
      throw new Error(`connect failed: ${String(url)}`)
    })
    const file = await readSourceBytes({ ...def, fixture: 'krosno.csv' }, { rawDir: null, refresh: true, secrets: { CITY_KEY: 's3cret/value' } })
    expect(file!.origin).toBe('fixture')
    expect(file!.error).toContain('connect failed')
    expect(file!.error).not.toContain('s3cret')
  })
})

describe('a reference from one source to another', () => {
  const city: DedupItem = { index: 0, sourceId: 'um-warszawa', key: '1150', priority: 80, lat: 52.2313, lon: 21.0102, name: 'Stacja metra Centrum', street: 'Marszałkowska', number: '100' }
  // 70 m away and named after the operator: by position and name alone this is not the same device.
  const mapped = (over: Partial<DedupItem> = {}): DedupItem => ({ index: 1, sourceId: 'osm-pl', key: 'node/1', priority: 40, lat: 52.23193, lon: 21.0102, name: 'Metro Warszawskie', street: '', number: '', ...over })
  const pointing = { refs: [{ sourceId: 'um-warszawa', key: '1150' }] }

  it('joins the record to the one it points at, whatever the names say', () => {
    expect(compare(city, mapped()).decision).not.toBe('auto')
    expect(cluster([city, mapped()]).clusters).toEqual([[0], [1]])
    expect(cluster([city, mapped(pointing)])).toEqual({ clusters: [[0, 1]], reviews: [] })
  })

  it('does not believe a reference to a record that lies somewhere else', () => {
    expect(cluster([city, mapped({ ...pointing, lat: 52.25 })]).clusters).toEqual([[0], [1]])
  })

  it('ignores a reference to a record nobody has, and keeps two records of one source apart', () => {
    expect(cluster([city, mapped({ refs: [{ sourceId: 'um-warszawa', key: '9999' }] })]).clusters).toEqual([[0], [1]])
    const second = mapped({ ...pointing, index: 2, key: 'node/2' })
    expect(cluster([city, mapped(pointing), second]).clusters).toEqual([[0, 1], [2]])
  })

  it('is declared for OpenStreetMap, whose mappers note the number the city gave the device', () => {
    const osm = loadSourceDefs().find((def) => def.kind === 'osm')!
    expect(osm.refs).toEqual({ 'ref:api-um-warszawa-pl': warsaw.id })
  })
})

describe('a plain list of objects', () => {
  it('is read as a table, so a JSON export needs no GeoJSON wrapping', () => {
    const table = parseAny(new TextEncoder().encode('[{"nazwa":"Ratusz","szerokosc":52.1},{"nazwa":"Basen","uwagi":"parter"}]'))
    expect(table.format).toBe('geojson')
    expect(table.rows).toEqual([
      { '@lon': '', '@lat': '', nazwa: 'Ratusz', szerokosc: '52.1', uwagi: '' },
      { '@lon': '', '@lat': '', nazwa: 'Basen', szerokosc: '', uwagi: 'parter' },
    ])
  })
})

describe('words offices use', () => {
  it('understands where the device hangs and keeps what was written after it', () => {
    expect(parseIndoor('Wewnątrz budynku')).toEqual({ indoor: true, rest: '' })
    expect(parseIndoor('Na zewnątrz budynku')).toEqual({ indoor: false, rest: '' })
    expect(parseIndoor('Wewnątrz budynku, ściana, peron w kierunku Kabaty')).toEqual({ indoor: true, rest: 'ściana, peron w kierunku Kabaty' })
    expect(parseIndoor('tak')).toEqual({ indoor: true, rest: '' })
    expect(parseIndoor('przy portierni')).toBeNull()
  })

  it('reads working days and spelled-out lists of days', () => {
    expect(parseOpeningHours('dni powszednie 07:00-17:30')).toBe('Mo-Fr 07:00-17:30')
    expect(parseOpeningHours('Poniedziałek - piątek, godziny 6:00 - 21:00')).toBe('Mo-Fr 06:00-21:00')
    expect(parseOpeningHours('pon. do piąt 6:00 do 21:00 , sob i niedz. 9:00 do 21:00')).toBe('Mo-Fr 06:00-21:00; Sa,Su 09:00-21:00')
    expect(parseOpeningHours('dni robocze- poniedziałek w godz.08.00-18.00, wtorek-piątek 08.00-16.00')).toBe('Mo 08:00-18:00; Tu-Fr 08:00-16:00')
    expect(parseOpeningHours('W godzinach otwarcia stacji metra')).toBeNull()
  })
})
