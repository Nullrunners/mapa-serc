/**
 * Writes the data pattern workbook to zgloszenie/wzorzec-danych-aed.xlsx at the repository root: the copy that
 * goes into the submission. Run with `pnpm pattern` after any change to the field catalogue.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FIELD_NAMES, SCHEMA_VERSION } from '@aed/schema'
import { patternWorkbook } from '../src/publish/xlsx'

const directory = resolve(import.meta.dirname, '../../../zgloszenie')
const path = resolve(directory, 'wzorzec-danych-aed.xlsx')
const bytes = await patternWorkbook()
mkdirSync(directory, { recursive: true })
writeFileSync(path, bytes)
console.log(`${path} written: ${FIELD_NAMES.length} fields, pattern version ${SCHEMA_VERSION}, ${bytes.length} bytes`)
