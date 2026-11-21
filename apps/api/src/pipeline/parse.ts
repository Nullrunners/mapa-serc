/**
 * Reads whatever a provider hands us (CSV in any dialect, GeoJSON) into rows of header → text.
 * Everything the reader has to repair on the way is recorded as a fix, so the provider can be told.
 */
import type { Fix, RawTable } from './types'

// ------------------------------------------------------------------ decoding

/** UTF-8 when the bytes are valid UTF-8, otherwise Windows-1250 (the usual export of Polish Excel). */
export function decodeText(bytes: Uint8Array): { text: string; fixes: Fix[] } {
  const fixes: Fix[] = []
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1250').decode(bytes)
    fixes.push({ code: 'encoding_windows_1250', message: 'Plik był zapisany w kodowaniu Windows-1250; odczytano go i zapisano w UTF-8.' })
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
    fixes.push({ code: 'bom_removed', message: 'Usunięto znacznik BOM z początku pliku.' })
  }
  return { text, fixes }
}

// ----------------------------------------------------------------------- CSV

const DELIMITERS = [',', ';', '\t', '|'] as const

/** RFC 4180 reader: quoted fields, doubled quotes, line breaks inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"' && field.trim() === '') {
      field = ''
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

/** The delimiter that splits the first lines into the same number (> 1) of columns most consistently. */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/, 12).join('\n')
  let best: { delimiter: string; score: number } = { delimiter: ',', score: -1 }
  for (const delimiter of DELIMITERS) {
    const widths = parseDelimited(sample, delimiter).map((cells) => cells.length)
    const width = widths[0] ?? 0
    if (width < 2) continue
    const consistent = widths.filter((value) => value === width).length / widths.length
    const score = consistent * 100 + width
    if (score > best.score) best = { delimiter, score }
  }
  return best.delimiter
}

/**
 * Some exports wrap every line in one pair of quotes and double the real ones
 * ("a,b,""c"""), so the whole line parses as a single cell. Detect that and unwrap.
 */
function unwrapQuotedLines(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) return null
  const wrapped = lines.every((line) => line.startsWith('"') && line.endsWith('"'))
  if (!wrapped) return null
  const singleCell = lines.every((line) => parseDelimited(line, ',').length === 1 && (parseDelimited(line, ',')[0]?.length ?? 0) === 1)
  if (!singleCell) return null
  return lines.map((line) => parseDelimited(line, ',')[0]![0]!).join('\n')
}

export function parseCsv(input: string | Uint8Array): RawTable {
  const decoded = typeof input === 'string' ? { text: input.replace(/^﻿/, ''), fixes: [] as Fix[] } : decodeText(input)
  const fixes = [...decoded.fixes]
  let text = decoded.text

  const unwrapped = unwrapQuotedLines(text)
  if (unwrapped !== null) {
    text = unwrapped
    fixes.push({
      code: 'whole_line_quoted',
      message: 'Każdy wiersz pliku był ujęty w cudzysłów i czytał się jako jedna kolumna; zdjęto zewnętrzne cudzysłowy.',
    })
  }

  const table = parseDelimited(text, sniffDelimiter(text))
  const headerRow = table[0] ?? []
  const headers = headerRow.map((header, index) => header.trim() || `kolumna_${index + 1}`)
  if (headerRow.some((header) => header !== header.trim())) {
    fixes.push({ code: 'header_trimmed', message: 'Nagłówki kolumn miały zbędne spacje na początku lub końcu.' })
  }

  const rows = table.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()])))
  return { headers, rows, fixes }
}

// ------------------------------------------------------------------- GeoJSON

/** Column names the GeoJSON reader adds for the geometry of each feature. */
export const GEO_LAT = '@lat'
export const GEO_LON = '@lon'

const text = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** First coordinate pair of any geometry; AED data is points, anything else contributes its first vertex. */
function firstPosition(coordinates: unknown): [number, number] | null {
  if (!Array.isArray(coordinates)) return null
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') return [coordinates[0], coordinates[1]]
  return firstPosition(coordinates[0])
}

/**
 * The list of features in a document. Besides a FeatureCollection this takes what city services really send:
 * the list wrapped in `result` (Warsaw's API) or the bare list.
 */
function featureList(document: unknown): unknown[] {
  if (Array.isArray(document)) return document
  const { features, result } = (document ?? {}) as { features?: unknown; result?: unknown }
  if (Array.isArray(features)) return features
  return Array.isArray(result) ? result : []
}

export function parseGeoJson(input: string | Uint8Array): RawTable {
  const decoded = typeof input === 'string' ? { text: input, fixes: [] as Fix[] } : decodeText(input)
  const features = featureList(JSON.parse(decoded.text))

  const headers = new Set<string>([GEO_LON, GEO_LAT])
  const rows = features.map((feature) => {
    const item = (feature ?? {}) as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }
    // A plain list of objects (no `properties`, no `geometry`) is a table whose rows are the objects themselves.
    const { geometry } = item
    const properties = item.properties ?? (geometry ? {} : (item as Record<string, unknown>))
    const row: Record<string, string> = {}
    const position = firstPosition(geometry?.coordinates)
    row[GEO_LON] = position ? String(position[0]) : ''
    row[GEO_LAT] = position ? String(position[1]) : ''
    for (const [key, value] of Object.entries(properties ?? {})) {
      headers.add(key)
      row[key] = text(value)
    }
    return row
  })
  const names = [...headers]
  for (const row of rows) for (const name of names) row[name] ??= ''
  return { headers: names, rows, fixes: decoded.fixes }
}

/** Picks the reader by what the content looks like, so the wizard does not depend on a file extension. */
export function parseAny(bytes: Uint8Array): RawTable & { format: 'csv' | 'geojson' } {
  const head = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(0, 64)).replace(/^﻿/, '').trimStart()
  if (head.startsWith('{') || head.startsWith('[')) return { ...parseGeoJson(bytes), format: 'geojson' }
  return { ...parseCsv(bytes), format: 'csv' }
}
