/** The pattern as a workbook, and the data scope of each source against the pattern. */
import ExcelJS from 'exceljs'
import { beforeAll, describe, expect, it } from 'vitest'
import { FIELD_NAMES, INPUT_FIELD_NAMES, SYSTEM_FIELDS } from '@aed/schema'
import { parseDelimited } from '../src/pipeline/parse'
import { runPipeline, type PipelineResult, type SourceReport } from '../src/pipeline/run'
import { loadSourceDefs } from '../src/pipeline/sources'
import { toScopeCsv } from '../src/publish/files'
import { PATTERN_SHEETS, patternWorkbook } from '../src/publish/xlsx'

describe('pattern workbook', () => {
  const workbook = new ExcelJS.Workbook()
  beforeAll(async () => {
    await workbook.xlsx.load((await patternWorkbook()).buffer)
  })

  const column = (sheet: string, index: number) => (workbook.getWorksheet(sheet)!.getColumn(index).values as unknown[]).slice(2)
  const row = (sheet: string, index: number) => (workbook.getWorksheet(sheet)!.getRow(index).values as unknown[]).slice(1)

  it('has the field table first, then dictionaries, example, template and notes', () => {
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(Object.values(PATTERN_SHEETS))
  })

  it('lists every field of the pattern, in catalogue order', () => {
    expect(column(PATTERN_SHEETS.pattern, 3)).toEqual(FIELD_NAMES)
    const whoFills = column(PATTERN_SHEETS.pattern, 7)
    expect(FIELD_NAMES.filter((_, index) => whoFills[index] === 'system')).toEqual(SYSTEM_FIELDS)
  })

  it('gives a template whose header is the header of the national CSV', () => {
    expect(row(PATTERN_SHEETS.template, 1)).toEqual(FIELD_NAMES)
    expect(workbook.getWorksheet(PATTERN_SHEETS.template)!.rowCount).toBe(1)
  })

  it('keeps codes with a leading zero as text', () => {
    const example = row(PATTERN_SHEETS.example, 2)
    expect(example[FIELD_NAMES.indexOf('kod_simc')]).toBe('0920806')
    expect(example[FIELD_NAMES.indexOf('wewnatrz_budynku')]).toBe('true')
    expect(example[FIELD_NAMES.indexOf('szerokosc_geograficzna')]).toBe(52.395198)
  })

  it('offers the dictionary values as a list in the template', () => {
    const sheet = workbook.getWorksheet(PATTERN_SHEETS.template)!
    const cell = sheet.getCell(2, FIELD_NAMES.indexOf('dostep') + 1)
    expect(cell.dataValidation).toMatchObject({ type: 'list', formulae: ['"publiczny,ograniczony,prywatny"'] })
    expect(sheet.getCell(2, FIELD_NAMES.indexOf('licencja') + 1).dataValidation).toBeUndefined()
  })
})

describe('data scope of the sources', () => {
  let result: PipelineResult
  const report = (name: string): SourceReport => result.reports.find((candidate) => candidate.name === name)!
  const scope = (name: string, field: string) => report(name).coverage.find((entry) => entry.field === field)!

  beforeAll(async () => {
    const defs = loadSourceDefs().filter((def) => def.kind === 'official')
    result = await runPipeline({ defs, stored: [], rawDir: null, refresh: false, geo: null, cachedGeo: null, existingIds: new Map(), previous: new Map(), today: '2026-11-21' })
  })

  it('has one entry per field a source can deliver, for every source', () => {
    expect(result.reports).toHaveLength(4)
    for (const line of result.reports) expect(line.coverage.map((entry) => entry.field)).toEqual(INPUT_FIELD_NAMES)
  })

  it('tells a column of the file from a constant of the source', () => {
    expect(scope('Urząd Miasta Krosna', 'nazwa')).toEqual({ field: 'nazwa', provided: 21, added: 0, constant: false })
    // Krosno's file has no commune code; the source definition sets it for every row.
    expect(scope('Urząd Miasta Krosna', 'kod_terc')).toMatchObject({ provided: 21, constant: true })
    // Legionowo publishes the code as a column.
    expect(scope('Urząd Miasta Legionowo', 'kod_terc')).toMatchObject({ provided: 24, constant: false })
    expect(scope('Urząd Miasta Legionowo', 'kod_simc')).toMatchObject({ provided: 24, constant: false })
  })

  it('shows what no official source delivers yet', () => {
    for (const line of result.reports) {
      expect(line.coverage.find((entry) => entry.field === 'termin_waznosci_baterii')).toMatchObject({ provided: 0, added: 0 })
    }
    // The Marki row with coordinates pasted from another town lost them; offline nothing puts them back.
    expect(scope('Urząd Miasta Marki', 'szerokosc_geograficzna')).toMatchObject({ provided: 7, added: 0 })
  })

  it('exports the scope as one CSV row per source and field', () => {
    const table = parseDelimited(toScopeCsv(result.reports), ',')
    expect(table).toHaveLength(1 + 4 * INPUT_FIELD_NAMES.length)
    expect(table[0]).toEqual(['zrodlo_id', 'zrodlo', 'licencja', 'liczba_wierszy', 'pole', 'wymagalnosc', 'wiersze_z_wartoscia_ze_zrodla', 'wiersze_uzupelnione_z_rejestrow', 'udzial_ze_zrodla', 'stala_dla_zrodla'])
    const marki = table.find((cells) => cells[1]!.startsWith('Urząd Miasta Marki') && cells[4] === 'szerokosc_geograficzna')!
    expect(marki.slice(3)).toEqual(['8', 'szerokosc_geograficzna', 'required', '7', '0', '0.875', 'false'])
  })
})
