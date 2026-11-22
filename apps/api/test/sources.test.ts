/** The four official files, exactly as dane.gov.pl serves them, must come out clean. */
import { describe, expect, it } from 'vitest'
import { UNNAMED_PLACE } from '@aed/schema'
import { addressFromPoint, createGeo, memoryCache } from '../src/pipeline/geocode'
import { parseOpeningHours, parsePhone, puwg1992ToWgs84, resolveCoordinates, splitAddress } from '../src/pipeline/normalize'
import { parseCsv } from '../src/pipeline/parse'
import { checkSource, loadSourceDefs, normalizeSource, parseSource, readSourceBytes } from '../src/pipeline/sources'
import type { NormalizedRecord, SourceDef } from '../src/pipeline/types'

const defs = loadSourceDefs()
const def = (name: string): SourceDef => defs.find((candidate) => candidate.fixture?.startsWith(name))!

async function load(name: string): Promise<{ records: NormalizedRecord[]; tableFixes: string[] }> {
  const source = def(name)
  const file = await readSourceBytes(source, { rawDir: null, refresh: false })
  const table = parseSource(source, file!.bytes)
  const records = normalizeSource(source, table)
  checkSource(source, records)
  return { records, tableFixes: table.fixes.map((fix) => fix.code) }
}

describe('Krosno', () => {
  it('reads longitude-first columns and splits the address', async () => {
    const { records, tableFixes } = await load('krosno')
    expect(records).toHaveLength(21)
    expect(tableFixes).toContain('header_trimmed')
    const office = records.find((record) => record.input.nazwa === 'Urząd Miasta Krosna')!
    expect(office.input).toMatchObject({
      szerokosc_geograficzna: 49.6839901,
      dlugosc_geograficzna: 21.7711307,
      cecha_ulicy: 'ulica',
      nazwa_ulicy: 'Lwowska',
      nr_budynku: '28a',
      kod_pocztowy: '38-400',
      miejscowosc: 'Krosno',
      kod_terc: '1861011',
      id_w_zrodle: '22',
    })
    expect(records.every((record) => record.input.szerokosc_geograficzna! > 49 && record.input.szerokosc_geograficzna! < 50)).toBe(true)
  })
})

describe('Marki', () => {
  it('unwraps whole-line quotes and swaps the coordinates back', async () => {
    const { records, tableFixes } = await load('marki')
    expect(records).toHaveLength(8)
    expect(tableFixes).toContain('whole_line_quoted')
    const office = records.find((record) => record.sourceKey === '1')!
    expect(office.input).toMatchObject({ nazwa: 'Urząd Miasta Marki', szerokosc_geograficzna: 52.326697, dlugosc_geograficzna: 21.107557, cecha_ulicy: 'aleja', nazwa_ulicy: 'Piłsudskiego', nr_budynku: '95' })
    expect(office.fixes.map((fix) => fix.code)).toContain('coordinates_swapped')
  })

  it('rejects the row whose coordinates were pasted from Krosno', async () => {
    const { records } = await load('marki')
    const school = records.find((record) => record.sourceKey === '7')!
    expect(school.input.szerokosc_geograficzna).toBeUndefined()
    expect(school.issues.map((issue) => issue.code)).toContain('address_point_mismatch')
    expect(school.input.nazwa_ulicy).toBe('Wczsowa')
  })

  it('warns about two devices sharing one point', async () => {
    const { records } = await load('marki')
    const flagged = records.filter((record) => record.issues.some((issue) => issue.code === 'coordinates_duplicate_in_source'))
    expect(flagged.map((record) => record.sourceKey).sort()).toEqual(['5', '6'])
  })
})

describe('Legionowo', () => {
  it('conforms to the pattern as published', async () => {
    const { records, tableFixes } = await load('legionowo')
    expect(records).toHaveLength(24)
    expect(tableFixes).toEqual(['bom_removed'])
    expect(records.flatMap((record) => record.issues)).toEqual([])
    expect(records.flatMap((record) => record.fixes)).toEqual([])
    expect(records[0]!.input).toMatchObject({ nazwa: 'Urząd Miasta Legionowo', cecha_ulicy: 'ulica', nazwa_ulicy: 'Piłsudskiego', nr_budynku: '41', kod_terc: '1408011', kod_simc: '0920806' })
  })
})

describe('Przemyśl', () => {
  it('takes the point from the geometry and the device number from the name', async () => {
    const { records } = await load('przemysl')
    expect(records).toHaveLength(21)
    const first = records.find((record) => record.sourceKey === '744')!
    expect(first.input).toMatchObject({ nazwa: 'ADM Centrum', id_w_zrodle: '9485', nazwa_ulicy: 'Juliusza Słowackiego', nr_budynku: '12', szerokosc_geograficzna: 49.7812096, dlugosc_geograficzna: 22.7750936 })
    expect(records.find((record) => record.sourceKey === '746')!.input.telefon_kontaktowy).toBe('+48166779500')
  })
})

describe('normalisation rules', () => {
  it('recognises coordinates in every notation', () => {
    expect(resolveCoordinates('52,326697', '21,107557')).toMatchObject({ lat: 52.326697, lon: 21.107557 })
    expect(resolveCoordinates('21.107557', '52.326697').fixes[0]!.code).toBe('coordinates_swapped')
    const dms = resolveCoordinates('52°19\'36.1"N', '21°06\'27.2"E')
    expect(dms.lat).toBeCloseTo(52.326694, 5)
    expect(dms.lon).toBeCloseTo(21.107556, 5)
    expect(resolveCoordinates('40.4', '-3.7').issues[0]!.code).toBe('coordinates_outside_poland')
  })

  it('converts the national grid to WGS84', () => {
    // Marszałkowska 1, Warszawa, as the GUGiK geocoder returns it in EPSG:2180 and in EPSG:4326.
    const point = puwg1992ToWgs84(638027.42, 485064.76)
    expect(point.lat).toBeCloseTo(52.2143273, 6)
    expect(point.lon).toBeCloseTo(21.020953, 6)
    expect(resolveCoordinates('485064.76', '638027.42').fixes[0]!.code).toBe('coordinates_puwg1992')
  })

  it('splits addresses', () => {
    expect(splitAddress('ul. Kazimierza Wielkiego 4, , 38-400 Krosno')).toEqual({ cecha_ulicy: 'ulica', nazwa_ulicy: 'Kazimierza Wielkiego', nr_budynku: '4', kod_pocztowy: '38-400', miejscowosc: 'Krosno' })
    expect(splitAddress('Al.. Piłsudskiego 95, 05-270 Marki')).toMatchObject({ cecha_ulicy: 'aleja', nazwa_ulicy: 'Piłsudskiego', nr_budynku: '95' })
    expect(splitAddress('ul. Rynek 1, 38-400 Krosno')).toMatchObject({ cecha_ulicy: 'ulica', nazwa_ulicy: 'Rynek', nr_budynku: '1' })
    expect(splitAddress('ul. Franciszka Żwirki i Stanisława Wigury, 38-400 Krosno')).toMatchObject({ nazwa_ulicy: 'Franciszka Żwirki i Stanisława Wigury' })
    expect(splitAddress('3 Maja 19, Przemyśl')).toMatchObject({ nazwa_ulicy: '3 Maja', nr_budynku: '19', miejscowosc: 'Przemyśl' })
  })

  it('writes opening hours in the OSM syntax', () => {
    expect(parseOpeningHours('całodobowo')).toBe('24/7')
    expect(parseOpeningHours('pn-pt 7.30-15.30')).toBe('Mo-Fr 07:30-15:30')
    expect(parseOpeningHours('poniedziałek – piątek 8-16, sobota 8-12')).toBe('Mo-Fr 08:00-16:00; Sa 08:00-12:00')
    expect(parseOpeningHours('Mo-Fr 08:00-16:00')).toBe('Mo-Fr 08:00-16:00')
    expect(parseOpeningHours('w godzinach pracy urzędu')).toBeNull()
  })

  it('normalises phones', () => {
    expect(parsePhone('(22) 766-72-00')).toBe('+48227667200')
    expect(parsePhone('+48 16 677 95 00')).toBe('+48166779500')
    expect(parsePhone('112')).toBeNull()
  })

  it('reads Windows-1250 and semicolons', () => {
    const bytes = new Uint8Array([...Buffer.from('nazwa;szeroko'), 0x9c, 0xe6, ...Buffer.from(';d'), 0xb3, ...Buffer.from('ugo'), 0x9c, 0xe6, ...Buffer.from('\r\nSzko'), 0xb3, ...Buffer.from('a;52,1;21,0\r\n')])
    const table = parseCsv(bytes)
    expect(table.headers).toEqual(['nazwa', 'szerokość', 'długość'])
    expect(table.rows[0]).toEqual({ nazwa: 'Szkoła', szerokość: '52,1', długość: '21,0' })
    expect(table.fixes.map((fix) => fix.code)).toContain('encoding_windows_1250')
  })
})

describe('OpenStreetMap', () => {
  const osm = defs.find((candidate) => candidate.kind === 'osm')!
  const device = (tags: Record<string, string>) => normalizeSource(osm, { headers: [], rows: [{ '@osm_id': '1', '@lat': '49.7838', '@lon': '22.7678', ...tags }], fixes: [] })[0]!.input

  it('names a device after its place or keeper, never after the words about its spot', () => {
    expect(device({ name: 'Ratusz', operator: 'Urząd Miejski' }).nazwa).toBe('Ratusz')
    expect(device({ operator: 'Urząd Miejski', 'defibrillator:location': 'przy wejściu' })).toMatchObject({ nazwa: 'Urząd Miejski', opis_lokalizacji: 'przy wejściu' })
    expect(device({ 'defibrillator:location': 'Na ścianie budynku', description: 'Po godzinach dzwonić do ochrony' })).toMatchObject({
      nazwa: UNNAMED_PLACE,
      opis_lokalizacji: 'Na ścianie budynku',
      uwagi_dostepu: 'Po godzinach dzwonić do ochrony',
    })
  })

  describe('address from the position', () => {
    // Answers of the address register (UUG, GetAddressReverse), cut down to the fields that are read.
    const REGISTER: Record<string, Record<string, string | null> | null> = {
      'POINT(22.7678 49.7838)': { city: 'Przemyśl', street: 'Tadeusza Kościuszki', number: '7', code: '37-700', simc: '0971672', x: '22.76764', y: '49.78362' },
      'POINT(21.0122 52.2297)': { city: 'Warszawa', street: 'ulica Marszałkowska', number: '94/98', code: '00-510', simc: '0918123', x: '21.01267', y: '52.22925' },
      'POINT(21.47 50.03)': { city: 'Latoszyn', street: null, number: '12', code: '39-200', simc: '0650470', x: '21.4701', y: '50.0301' },
      'POINT(20.622 49.96)': null,
    }
    let asked = 0
    const register: typeof fetch = async (url) => {
      asked++
      const found = REGISTER[new URL(String(url)).searchParams.get('location')!]
      return new Response(JSON.stringify({ results: found ? { '1': found } : null }))
    }
    const point = (lat: number, lon: number, input: NormalizedRecord['input'] = {}, fixes: NormalizedRecord['fixes'] = []): NormalizedRecord => ({
      sourceId: 'osm-pl',
      sourceKey: `${lat},${lon}`,
      input: { szerokosc_geograficzna: lat, dlugosc_geograficzna: lon, ...input },
      raw: {},
      fixes,
      issues: [],
    })

    it('fills the street, number, postcode and locality of the nearest address point', async () => {
      const town = point(49.7838, 22.7678, { miejscowosc: 'Przemyśl' })
      const avenue = point(52.2297, 21.0122)
      // The commune is Dębica; the device stands in one of its villages, which has no street names.
      const village = point(50.03, 21.47, { miejscowosc: 'Dębica' }, [{ code: 'locality_from_commune', field: 'miejscowosc', message: '', after: 'Dębica' }])
      const nowhere = point(49.96, 20.622, { miejscowosc: 'Zakliczyn' })
      await addressFromPoint([town, avenue, village, nowhere], createGeo(memoryCache(), register))

      expect(town.input).toMatchObject({ nazwa_ulicy: 'Tadeusza Kościuszki', nr_budynku: '7', kod_pocztowy: '37-700', miejscowosc: 'Przemyśl', kod_simc: '0971672' })
      expect(town.fixes.map((fix) => fix.code)).toEqual(['address_from_coordinates', 'postcode_from_register', 'simc_from_register'])
      expect(avenue.input).toMatchObject({ cecha_ulicy: 'ulica', nazwa_ulicy: 'Marszałkowska', nr_budynku: '94/98', miejscowosc: 'Warszawa' })
      expect(village.input).toMatchObject({ nr_budynku: '12', miejscowosc: 'Latoszyn', kod_pocztowy: '39-200' })
      expect(village.input.nazwa_ulicy).toBeUndefined()
      expect(village.fixes.map((fix) => fix.code)).not.toContain('locality_from_commune')
      expect(nowhere.input).toEqual({ szerokosc_geograficzna: 49.96, dlugosc_geograficzna: 20.622, miejscowosc: 'Zakliczyn' })
    })

    it('leaves alone a record that has an address, names another locality, or was never looked up', async () => {
      asked = 0
      const addressed = point(49.7838, 22.7678, { nazwa_ulicy: 'Rynek', nr_budynku: '1' })
      await addressFromPoint([addressed], createGeo(memoryCache(), register))
      expect(asked).toBe(0)
      expect(addressed.input.nr_budynku).toBe('1')

      const elsewhere = point(49.7838, 22.7678, { miejscowosc: 'Ostrów' })
      await addressFromPoint([elsewhere], createGeo(memoryCache(), register))
      expect(elsewhere.input).toEqual({ szerokosc_geograficzna: 49.7838, dlugosc_geograficzna: 22.7678, miejscowosc: 'Ostrów' })

      // The pipeline reads OpenStreetMap answers from the cache only; a point the job has not asked about yet stays as it is.
      const cacheOnly = createGeo(memoryCache(), async () => {
        throw new Error('cache only')
      })
      const unseen = point(49.7838, 22.7678)
      await addressFromPoint([unseen], cacheOnly)
      expect(unseen.input.nr_budynku).toBeUndefined()
      expect(unseen.fixes).toEqual([])
    })

    it('does not remember a refusal of the register as "no address here"', async () => {
      let refused = true
      const flaky = createGeo(memoryCache(), async () =>
        refused ? new Response('{"notice":"blocked for abuse"}') : new Response(JSON.stringify({ results: { '1': REGISTER['POINT(22.7678 49.7838)'] } })),
      )
      await expect(flaky.nearestAddress(49.7838, 22.7678)).rejects.toThrow('blocked for abuse')
      await expect(flaky.address('Przemyśl, Tadeusza Kościuszki 7')).rejects.toThrow()
      refused = false
      expect(await flaky.nearestAddress(49.7838, 22.7678)).toMatchObject({ city: 'Przemyśl', number: '7' })
    })
  })
})
