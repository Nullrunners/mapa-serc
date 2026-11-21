/** A provider uploads an Excel workbook instead of a CSV file. */
import ExcelJS from 'exceljs'
import { beforeAll, describe, expect, it } from 'vitest'
import { FIELD_NAMES } from '@aed/schema'
import { createApp } from '../src/app'
import * as XLSX from 'xlsx'
import { declaredUnpackedSize, isLegacyXls, isXlsx, parseXls, parseXlsx } from '../src/pipeline/xlsx'
import { PATTERN_SHEETS, patternWorkbook } from '../src/publish/xlsx'

const app = createApp()
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const upload = (bytes: Uint8Array, fileName: string) => ({ fileName, contentBase64: Buffer.from(bytes).toString('base64') })

const bytesOf = async (workbook: ExcelJS.Workbook) => new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer)

/** A sheet as a town hall keeps it: typed cells, a date, a time, a formula, an empty row and a notes sheet in front. */
async function townHallWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Notatki').addRow(['Lista defibrylatorów gminy'])
  const sheet = workbook.addWorksheet('AED')
  sheet.addRow(['Obiekt', 'Ulica', 'Kod', 'Miasto', 'Szer. geogr.', 'Dł. geogr.', 'Data przeglądu', 'Otwarte od', 'Wewnątrz', 'Telefon'])
  sheet.addRow(['Urząd Gminy Testowo', 'ul. Długa 12', '86-005', 'Białe Błota', 53.0951, 17.9172, new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(1899, 11, 30, 7, 30)), true, { formula: 'A1', result: '52 381 14 13' }])
  sheet.addRow([])
  sheet.addRow([{ richText: [{ text: 'Hala ' }, { text: 'sportowa', font: { bold: true } }] }, 'ul. Centralna 27', '86-005', 'Białe Błota', 53.0972, 17.9201, null, null, false, null])
  return bytesOf(workbook)
}

beforeAll(async () => {
  expect((await post('/admin/jobs/pipeline', {}, { Authorization: 'Bearer test-token' })).status).toBe(200)
})

describe('reading a workbook', () => {
  it('skips sheets without a table and writes cells as text', async () => {
    const bytes = await townHallWorkbook()
    expect(isXlsx(bytes)).toBe(true)
    expect(declaredUnpackedSize(bytes)).toBeGreaterThan(bytes.length)

    const table = await parseXlsx(bytes)
    expect(table.fixes.map((fix) => fix.code)).toEqual(['sheet_selected'])
    expect(table.fixes[0]!.message).toContain('„AED"')
    expect(table.headers).toEqual(['Obiekt', 'Ulica', 'Kod', 'Miasto', 'Szer. geogr.', 'Dł. geogr.', 'Data przeglądu', 'Otwarte od', 'Wewnątrz', 'Telefon'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toMatchObject({ Obiekt: 'Urząd Gminy Testowo', 'Szer. geogr.': '53.0951', 'Data przeglądu': '2026-10-01', 'Otwarte od': '07:30', Wewnątrz: 'true', Telefon: '52 381 14 13' })
    expect(table.rows[1]).toMatchObject({ Obiekt: 'Hala sportowa', 'Data przeglądu': '', Wewnątrz: 'false', Telefon: '' })
  })

  it('reads the template sheet of our own pattern workbook, not its documentation', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load((await patternWorkbook()).buffer)
    const row = Object.fromEntries(FIELD_NAMES.map((name) => [name, '']))
    Object.assign(row, { nazwa: 'Biblioteka Publiczna', miejscowosc: 'Legionowo', kod_simc: '0920806', szerokosc_geograficzna: 52.4012, dlugosc_geograficzna: 20.9267, dostep: 'publiczny', godziny_dostepnosci: 'Mo-Fr 08:00-16:00' })
    workbook.getWorksheet(PATTERN_SHEETS.template)!.addRow(FIELD_NAMES.map((name) => row[name]))

    const table = await parseXlsx(await bytesOf(workbook))
    expect(table.headers).toEqual(FIELD_NAMES)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toMatchObject({ nazwa: 'Biblioteka Publiczna', kod_simc: '0920806', szerokosc_geograficzna: '52.4012', godziny_dostepnosci: 'Mo-Fr 08:00-16:00' })
  })

  it('finds nothing in an untouched pattern workbook', async () => {
    const table = await parseXlsx(await patternWorkbook())
    expect(table.rows).toEqual([])
  })
})

describe('wizard preview of a workbook', () => {
  it('maps the columns and normalises the rows like a CSV', async () => {
    const response = await post('/v1/import/preview', upload(await townHallWorkbook(), 'aed-testowo.xlsx'))
    expect(response.status).toBe(200)
    const preview = (await response.json()) as any
    expect(preview.format).toBe('xlsx')
    expect(preview.summary).toMatchObject({ rows: 2, ready: 2, withErrors: 0 })
    const office = preview.rows.find((row: any) => row.record.nazwa === 'Urząd Gminy Testowo')
    expect(office.record).toMatchObject({ szerokosc_geograficzna: 53.0951, dlugosc_geograficzna: 17.9172, kod_pocztowy: '86-005', miejscowosc: 'Białe Błota', nazwa_ulicy: 'Długa', nr_budynku: '12', telefon_kontaktowy: '+48523811413' })
  })

  it('refuses a broken workbook, old or new, and an empty one', async () => {
    const legacy = await post('/v1/import/preview', upload(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), 'aed.xls'))
    expect(legacy.status).toBe(400)
    expect(((await legacy.json()) as any).code).toBe('file_unreadable')

    const broken = await post('/v1/import/preview', upload(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]), 'aed.xlsx'))
    expect(broken.status).toBe(400)

    const empty = await post('/v1/import/preview', upload(await patternWorkbook(), 'wzorzec-danych-aed.xlsx'))
    expect(empty.status).toBe(400)
  })
})

/**
 * A list as a city office publishes it: Excel 97–2003, a title above the table, a numbering column without a
 * header, addresses instead of coordinates, opening hours in words. The rows are made up.
 */
function cityOfficeXls(): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Wykaz defibrylatorów AED w obiektach miejskich'],
    [],
    ['', 'Podmiot', 'Obiekt', 'Adres', 'Lokalizacja w obiekcie ', 'Godz. dostępu', 'Data przeglądu', 'Szer.'],
    [1, 'Dom Pomocy Społecznej nr 9', 'Dom Pomocy Społecznej nr 9', 'ul. Długa 12, 86-005 Białe Błota', 'wewnątrz, parter – dyżurka pielęgniarek', 'całodobowe', new Date(Date.UTC(2026, 7, 17)), 53.0951234567],
    [2, 'Miejski Ośrodek Sportu', 'Pływalnia miejska', 'ul. Centralna 27, 86-005 Białe Błota', 'hol przy kasach', 'pon.-pt. 6.00-22.00', null, null],
  ], { UTC: true })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Arkusz1')
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'biff8' }) as ArrayBuffer)
}

describe('an old Excel file (.xls)', () => {
  it('is read like any other workbook: title skipped, digits and dates kept', () => {
    const bytes = cityOfficeXls()
    expect(isLegacyXls(bytes)).toBe(true)

    const table = parseXls(bytes)
    expect(table.headers).toEqual(['kolumna_1', 'Podmiot', 'Obiekt', 'Adres', 'Lokalizacja w obiekcie', 'Godz. dostępu', 'Data przeglądu', 'Szer.'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toMatchObject({ kolumna_1: '1', Obiekt: 'Dom Pomocy Społecznej nr 9', 'Godz. dostępu': 'całodobowe', 'Data przeglądu': '2026-08-17', 'Szer.': '53.0951234567' })
    expect(table.rows[1]).toMatchObject({ Obiekt: 'Pływalnia miejska', 'Data przeglądu': '', 'Szer.': '' })
  })

  it('goes through the wizard: columns matched by their headers, address split, hours in the pattern syntax', async () => {
    const response = await post('/v1/import/preview', upload(cityOfficeXls(), 'Defibrylatory2026.xls'))
    expect(response.status).toBe(200)
    const preview = (await response.json()) as any
    expect(preview.format).toBe('xls')
    expect(preview.summary.rows).toBe(2)

    const target = Object.fromEntries(preview.columns.map((column: any) => [column.header, column.target]))
    expect(target).toMatchObject({ Podmiot: 'podmiot_odpowiedzialny', Obiekt: 'nazwa', Adres: 'adres', 'Lokalizacja w obiekcie': 'opis_lokalizacji', 'Godz. dostępu': 'godziny_dostepnosci' })

    const home = preview.rows.find((row: any) => row.record.nazwa === 'Dom Pomocy Społecznej nr 9')
    expect(home.record).toMatchObject({ nazwa_ulicy: 'Długa', nr_budynku: '12', kod_pocztowy: '86-005', miejscowosc: 'Białe Błota', godziny_dostepnosci: '24/7', podmiot_odpowiedzialny: 'Dom Pomocy Społecznej nr 9' })
    const pool = preview.rows.find((row: any) => row.record.nazwa === 'Pływalnia miejska')
    expect(pool.record).toMatchObject({ godziny_dostepnosci: 'Mo-Fr 06:00-22:00', opis_lokalizacji: 'hol przy kasach' })
  })
})
