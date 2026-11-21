/**
 * The data pattern as an Excel workbook: the file the task card asks for ("tabela w formacie xlsx").
 * Generated from the same field catalogue as the CSV template, the Table Schema and the API contract.
 */
import ExcelJS from 'exceljs'
import { FIELDS, FILE_RULES, GROUPS, REQUIREMENT_LABEL, SCHEMA_TITLE, SCHEMA_VERSION, SYSTEM_FIELDS, TYPE_LABEL, constraintText, type FieldDef } from '@aed/schema'

const fields: readonly FieldDef[] = FIELDS
const isSystem = (field: FieldDef) => (SYSTEM_FIELDS as readonly string[]).includes(field.name)
const groupTitle = new Map<string, string>(GROUPS.map((group) => [group.id, group.title]))

export const PATTERN_SHEETS = { pattern: 'Wzorzec', dictionaries: 'Słowniki', example: 'Przykład', template: 'Szablon', about: 'Informacje' } as const

const HEADER_FILL = 'FF0052A5'
const SYSTEM_FILL = 'FF5A6570'
const GEO_ROLE = { label: 'etykieta punktu', b: 'szerokość geograficzna', l: 'długość geograficzna' } as const
/** Rows of the template that get drop-down lists and text formatting. */
const TEMPLATE_ROWS = 500

type Validations = { add(address: string, validation: ExcelJS.DataValidation): void }

/** Excel would turn `true` into a locale word and `0920806` into a number; text keeps the value as the CSV has it. */
const cellValue = (value: string | number | boolean): string | number => (typeof value === 'number' ? value : String(value))

function header(sheet: ExcelJS.Worksheet, columns: { title: string; width: number; wrap?: boolean }[], fill: (index: number) => string = () => HEADER_FILL): void {
  sheet.columns = columns.map(({ title, width, wrap }) => ({ header: title, width, style: { alignment: { vertical: 'top', wrapText: wrap ?? false } } }))
  columns.forEach((_, index) => {
    const cell = sheet.getCell(1, index + 1)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill(index) } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

function patternSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(PATTERN_SHEETS.pattern)
  header(sheet, [
    { title: 'Lp.', width: 5 },
    { title: 'Grupa', width: 24 },
    { title: 'Nazwa kolumny', width: 26 },
    { title: 'Nazwa pola', width: 24 },
    { title: 'Typ danych', width: 16 },
    { title: 'Wymagalność', width: 13 },
    { title: 'Kto wypełnia', width: 13 },
    { title: 'Opis', width: 70, wrap: true },
    { title: 'Dozwolone wartości', width: 32, wrap: true },
    { title: 'Format i ograniczenia', width: 36, wrap: true },
    { title: 'Przykład', width: 34, wrap: true },
    { title: 'Odpowiednik w OpenStreetMap', width: 24 },
    { title: 'Odpowiednik we francuskiej bazie Géo\'DAE', width: 24 },
    { title: 'Rola w widoku mapy dane.gov.pl', width: 24 },
  ])
  fields.forEach((field, index) =>
    sheet.addRow([
      index + 1,
      groupTitle.get(field.group) ?? field.group,
      field.name,
      field.title,
      TYPE_LABEL[field.type],
      REQUIREMENT_LABEL[field.requirement],
      isSystem(field) ? 'system' : 'dostawca',
      field.description,
      field.enum ? field.enum.join('; ') : '',
      constraintText(field),
      cellValue(field.example),
      field.osm ?? '',
      field.geoDae ?? '',
      field.portalGeoRole ? GEO_ROLE[field.portalGeoRole] : '',
    ]),
  )
  sheet.getColumn(3).font = { name: 'Consolas' }
  sheet.getCell(1, 3).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 14 } }
}

function dictionarySheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(PATTERN_SHEETS.dictionaries)
  header(sheet, [
    { title: 'Nazwa kolumny', width: 26 },
    { title: 'Wartość', width: 26 },
    { title: 'Znaczenie', width: 70, wrap: true },
  ])
  for (const field of fields) {
    field.enum?.forEach((value, index) => sheet.addRow([field.name, value, field.enumLabels?.[index] ?? '']))
    if (field.type === 'boolean') {
      sheet.addRow([field.name, 'true', 'tak'])
      sheet.addRow([field.name, 'false', 'nie'])
    }
  }
}

function exampleSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(PATTERN_SHEETS.example)
  header(
    sheet,
    fields.map((field) => ({ title: field.name, width: Math.max(14, field.name.length + 4) })),
  )
  sheet.addRow(fields.map((field) => cellValue(field.example)))
}

function templateSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(PATTERN_SHEETS.template)
  header(
    sheet,
    fields.map((field) => ({ title: field.name, width: Math.max(14, field.name.length + 4) })),
    (index) => (isSystem(fields[index]!) ? SYSTEM_FILL : HEADER_FILL),
  )
  const validations = (sheet as unknown as { dataValidations: Validations }).dataValidations
  fields.forEach((field, index) => {
    const column = sheet.getColumn(index + 1)
    // Text format, so that Excel does not strip the leading zero of a TERYT code or rewrite a date.
    if (field.type !== 'number') column.numFmt = '@'
    sheet.getCell(1, index + 1).note = isSystem(field)
      ? `${field.title}. Zostaw puste: tę kolumnę wypełnia system.`
      : `${field.title} (${REQUIREMENT_LABEL[field.requirement]}). ${field.description}`

    const values = field.enum ?? (field.type === 'boolean' ? ['true', 'false'] : null)
    if (!values || isSystem(field)) return
    for (let row = 2; row <= TEMPLATE_ROWS + 1; row++) {
      validations.add(`${column.letter}${row}`, {
        type: 'list',
        allowBlank: true,
        formulae: [`"${values.join(',')}"`],
        showErrorMessage: true,
        errorStyle: 'error',
        errorTitle: field.title,
        error: `Dozwolone wartości: ${values.join(', ')}.`,
      })
    }
  })
}

function aboutSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(PATTERN_SHEETS.about)
  sheet.columns = [
    { width: 26, style: { alignment: { vertical: 'top' }, font: { bold: true } } },
    { width: 110, style: { alignment: { vertical: 'top', wrapText: true } } },
  ]
  const required = fields.filter((field) => field.requirement === 'required').length
  const recommended = fields.filter((field) => field.requirement === 'recommended').length
  const rows: [string, string][] = [
    ['Tytuł', SCHEMA_TITLE],
    ['Wersja', SCHEMA_VERSION],
    ['Cel', 'Jednolity zakres danych, w którym każdy dysponent udostępnia informacje o defibrylatorach AED w portalu dane.gov.pl.'],
    ['Liczba pól', `${fields.length}, w tym ${required} wymaganych i ${recommended} zalecanych. ${SYSTEM_FIELDS.length} pola wypełnia system: ${SYSTEM_FIELDS.join(', ')}.`],
    ['Zasady pliku', FILE_RULES.join('\n')],
    [`Arkusz „${PATTERN_SHEETS.pattern}"`, 'Wszystkie pola wzorca: nazwa kolumny, typ, wymagalność, opis, dozwolone wartości, przykład.'],
    [`Arkusz „${PATTERN_SHEETS.dictionaries}"`, 'Wartości pól słownikowych i ich znaczenie.'],
    [`Arkusz „${PATTERN_SHEETS.example}"`, 'Jeden wiersz zbioru krajowego z wartościami przykładowymi.'],
    [`Arkusz „${PATTERN_SHEETS.template}"`, 'Pusty szablon do wypełnienia: nagłówek zgodny ze wzorcem, opis pola w komentarzu nagłówka, listy wyboru w polach słownikowych. Kolumny z szarym nagłówkiem wypełnia system.'],
    ['Pokrewne wzorce', 'Grupy pól odpowiadają francuskiej bazie krajowej Géo\'DAE, a słowniki tagom OpenStreetMap (emergency=defibrillator). Godziny dostępności są zapisywane w składni opening_hours.'],
  ]
  for (const row of rows) sheet.addRow(row)
}

/** A fixed date in the document properties. The zip container still stamps the build time, so two builds differ in bytes. */
const BUILT = new Date(Date.UTC(2026, 10, 21))

async function build(): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AED Hub'
  workbook.title = SCHEMA_TITLE
  workbook.created = BUILT
  workbook.modified = BUILT
  patternSheet(workbook)
  dictionarySheet(workbook)
  exampleSheet(workbook)
  templateSheet(workbook)
  aboutSheet(workbook)
  return new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
}

let cached: Promise<Uint8Array<ArrayBuffer>> | undefined

/** The workbook's bytes. The catalogue is fixed at build time, so the file is built once. */
export const patternWorkbook = (): Promise<Uint8Array<ArrayBuffer>> => (cached ??= build())
