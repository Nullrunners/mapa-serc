/** A provider uploads an Excel workbook instead of a CSV file. */
import ExcelJS from 'exceljs'
import { beforeAll, describe, expect, it } from 'vitest'
import { FIELD_NAMES } from '@aed/schema'
import { createApp } from '../src/app'
import { declaredUnpackedSize, isXlsx, parseXlsx } from '../src/pipeline/xlsx'
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

  it('explains what to do with an old .xls file and refuses a broken archive', async () => {
    const legacy = await post('/v1/import/preview', upload(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), 'aed.xls'))
    expect(legacy.status).toBe(400)
    expect(((await legacy.json()) as any).detail).toContain('.xlsx')

    const broken = await post('/v1/import/preview', upload(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]), 'aed.xlsx'))
    expect(broken.status).toBe(400)

    const empty = await post('/v1/import/preview', upload(await patternWorkbook(), 'wzorzec-danych-aed.xlsx'))
    expect(empty.status).toBe(400)
  })
})
