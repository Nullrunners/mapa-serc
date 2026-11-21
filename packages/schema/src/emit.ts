/** Artefacts generated from the field catalogue. Nothing here is written by hand twice. */
import { FIELDS, GROUPS, type FieldDef } from './fields'

export const SCHEMA_VERSION = '0.1.0'
export const SCHEMA_NAME = 'wzorzec-danych-aed'
export const SCHEMA_TITLE = 'Wzorzec danych: lokalizacje defibrylatorów AED'

const fields: readonly FieldDef[] = FIELDS

/** CSV header of the national file, in catalogue order. */
export const csvHeader = (): string[] => fields.map((field) => field.name)

/**
 * Frictionless Table Schema (https://specs.frictionlessdata.io/table-schema/): the format dane.gov.pl keeps
 * for tabular resources and the one France uses for its national AED database.
 */
export function tableSchema() {
  return {
    $schema: 'https://specs.frictionlessdata.io/schemas/table-schema.json',
    name: SCHEMA_NAME,
    title: SCHEMA_TITLE,
    version: SCHEMA_VERSION,
    description:
      'Jednolity zakres danych o publicznie dostępnych defibrylatorach AED do udostępniania w portalu dane.gov.pl. ' +
      'Pola wymagane są zawsze wypełnione; pola zalecane wypełnia opiekun przy zgłoszeniu urządzenia.',
    fields: fields.map((field) => {
      const constraints: Record<string, unknown> = {}
      if (field.requirement === 'required') constraints.required = true
      if (field.enum) constraints.enum = [...field.enum]
      if (field.pattern) constraints.pattern = field.pattern
      if (field.minimum !== undefined) constraints.minimum = field.minimum
      if (field.maximum !== undefined) constraints.maximum = field.maximum
      if (field.maxLength !== undefined) constraints.maxLength = field.maxLength
      if (field.name === 'id') constraints.unique = true
      return {
        name: field.name,
        title: field.title,
        description: field.description,
        type: field.type,
        ...(field.type === 'date' ? { format: 'default' } : {}),
        example: field.example,
        ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
        'x-wymagalnosc': field.requirement,
        ...(field.osm ? { 'x-osm': field.osm } : {}),
        ...(field.geoDae ? { 'x-geodae': field.geoDae } : {}),
        ...(field.portalGeoRole ? { 'x-dane-gov-pl-geo': field.portalGeoRole } : {}),
      }
    }),
    primaryKey: 'id',
    missingValues: [''],
  }
}

export const REQUIREMENT_LABEL = { required: 'wymagane', recommended: 'zalecane', optional: 'opcjonalne' } as const
export const TYPE_LABEL = { string: 'tekst', number: 'liczba', boolean: 'true / false', date: 'data RRRR-MM-DD' } as const

/** The rules every file made to the pattern follows; printed in the documentation and in the workbook. */
export const FILE_RULES = [
  'Plik CSV zgodny z RFC 4180, kodowanie UTF-8, separator przecinek.',
  'Jeden wiersz nagłówka z nazwami kolumn dokładnie jak we wzorcu.',
  'Jeden wiersz to jedno urządzenie.',
  'Liczby z kropką dziesiętną, daty w zapisie RRRR-MM-DD (ISO 8601), wartości logiczne true albo false.',
  'Puste pole oznacza brak danych.',
] as const

/** Limits of a field in words, for the documentation: length, range, format. */
export function constraintText(field: FieldDef): string {
  const parts: string[] = []
  if (field.type === 'date') parts.push('data w zapisie RRRR-MM-DD')
  if (field.type === 'boolean') parts.push('true albo false')
  if (field.type === 'number') parts.push('liczba z kropką dziesiętną')
  if (field.minimum !== undefined && field.maximum !== undefined) parts.push(`od ${field.minimum} do ${field.maximum}`)
  if (field.maxLength !== undefined) parts.push(`najwyżej ${field.maxLength} znaków`)
  if (field.pattern) parts.push(`wyrażenie regularne: ${field.pattern}`)
  return parts.join('; ')
}

/** Field documentation as Markdown: the human-readable "wzorcowy zakres danych". */
export function fieldDocsMarkdown(): string {
  const lines: string[] = [
    `# ${SCHEMA_TITLE}`,
    '',
    `Wersja ${SCHEMA_VERSION}. Plik CSV zgodny z RFC 4180: kodowanie UTF-8, separator przecinek, jeden wiersz nagłówka, ` +
      'liczby z kropką dziesiętną, daty w ISO 8601, puste pole oznacza brak danych.',
    '',
  ]
  for (const group of GROUPS) {
    lines.push(`## ${group.title}`, '', '| Kolumna | Typ | Wymagalność | Opis | Przykład |', '|---|---|---|---|---|')
    for (const field of fields.filter((candidate) => candidate.group === group.id)) {
      const values = field.enum
        ? ' Dozwolone wartości: ' +
          field.enum.map((value, index) => `\`${value}\`${field.enumLabels?.[index] ? ` – ${field.enumLabels[index]}` : ''}`).join('; ') +
          '.'
        : ''
      lines.push(
        `| \`${field.name}\` | ${TYPE_LABEL[field.type]} | ${REQUIREMENT_LABEL[field.requirement]} | ${field.description}${values} | \`${String(field.example)}\` |`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * CSVW metadata (https://www.w3.org/TR/tabular-metadata/) for the published CSV; the portal's technical
 * standard asks for it at the four-star level.
 */
export function csvwMetadata(csvUrl: string) {
  const datatype = { string: 'string', number: 'decimal', boolean: 'boolean', date: 'date' } as const
  return {
    '@context': ['http://www.w3.org/ns/csvw', { '@language': 'pl' }],
    url: csvUrl,
    'dc:title': SCHEMA_TITLE,
    'dc:conformsTo': SCHEMA_NAME + '/' + SCHEMA_VERSION,
    dialect: { delimiter: ',', encoding: 'utf-8', header: true, lineTerminators: ['\r\n'] },
    tableSchema: {
      primaryKey: 'id',
      columns: fields.map((field) => ({
        name: field.name,
        titles: field.name,
        'dc:description': field.description,
        datatype: datatype[field.type],
        required: field.requirement === 'required',
      })),
    },
  }
}
