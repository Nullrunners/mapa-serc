/**
 * Reads an Excel workbook (.xlsx) a provider uploads into the same rows of header → text as a CSV file.
 * Cells are turned into the text a careful person would have typed: dates as RRRR-MM-DD, logical values
 * as true / false, a formula as its result.
 */
import ExcelJS from 'exceljs'
import { PATTERN_SHEETS } from '../publish/xlsx'
import type { Fix, RawTable } from './types'

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((byte, index) => bytes[index] === byte)

/** An .xlsx file is a zip archive. */
export const isXlsx = (bytes: Uint8Array): boolean => startsWith(bytes, ZIP_MAGIC)
/** The binary format of Excel 97–2003 (.xls), which this reader does not open. */
export const isLegacyXls = (bytes: Uint8Array): boolean => startsWith(bytes, OLE_MAGIC)

/** What a workbook may unpack to. An upload of a few megabytes that declares more is not a spreadsheet of AEDs. */
const MAX_UNPACKED_BYTES = 80 * 1024 * 1024

/**
 * Sum of the uncompressed sizes the archive declares in its central directory; null when there is no directory.
 * It stops an ordinary zip bomb before anything is unpacked. An archive that lies about its sizes is not caught.
 */
export function declaredUnpackedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record sits in the last 22 bytes plus an optional comment of up to 64 KiB.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    const entries = view.getUint16(offset + 10, true)
    let position = view.getUint32(offset + 16, true)
    let total = 0
    for (let entry = 0; entry < entries; entry++) {
      if (position + 46 > bytes.length || view.getUint32(position, true) !== 0x02014b50) return null
      total += view.getUint32(position + 24, true)
      position += 46 + view.getUint16(position + 28, true) + view.getUint16(position + 30, true) + view.getUint16(position + 32, true)
    }
    return total
  }
  return null
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    const iso = value.toISOString()
    // A cell that holds only a time of day is stored as a moment on Excel's day zero (30 December 1899).
    return value.getUTCFullYear() < 1900 ? iso.slice(11, 16) : iso.slice(0, 10)
  }
  if ('richText' in value) return value.richText.map((part) => part.text).join('').trim()
  if ('formula' in value || 'sharedFormula' in value) return cellText(value.result as ExcelJS.CellValue | undefined)
  if ('text' in value) return cellText(value.text as ExcelJS.CellValue | undefined)
  return ''
}

function readSheet(sheet: ExcelJS.Worksheet): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      cells[column - 1] = cellText(cell.value)
    })
    const line = Array.from(cells, (cell) => cell ?? '')
    if (line.some((cell) => cell !== '')) lines.push(line)
  })
  const [first, ...rest] = lines
  if (!first) return { headers: [], rows: [] }
  const headers = first.map((header, index) => header || `kolumna_${index + 1}`)
  return { headers, rows: rest.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))) }
}

/**
 * The table of the workbook: the template sheet when the workbook was made from our pattern file (its other
 * sheets are documentation), otherwise the first sheet that holds a header and at least one row.
 */
export async function parseXlsx(bytes: Uint8Array): Promise<RawTable> {
  const declared = declaredUnpackedSize(bytes)
  if (declared === null) throw new Error('The file is not a readable zip archive.')
  if (declared > MAX_UNPACKED_BYTES) throw new Error('The workbook would unpack to more than the reader accepts.')

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const sheets = workbook.worksheets.map((sheet) => ({ name: sheet.name, ...readSheet(sheet) }))
  const chosen = sheets.find((sheet) => sheet.name === PATTERN_SHEETS.template) ?? sheets.find((sheet) => sheet.rows.length > 0 && sheet.headers.length >= 2)
  if (!chosen) return { headers: [], rows: [], fixes: [] }

  const fixes: Fix[] = sheets.length > 1 ? [{ code: 'sheet_selected', message: `Skoroszyt ma kilka arkuszy; odczytano arkusz „${chosen.name}".` }] : []
  return { headers: chosen.headers, rows: chosen.rows, fixes }
}
