/** The four official files, exactly as dane.gov.pl serves them, must come out clean. */
import { describe, expect, it } from 'vitest'
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
