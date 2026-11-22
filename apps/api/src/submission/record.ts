/**
 * One device reported through the form, as a record of the shared source of user reports. The form sends a few
 * fields of the data pattern; they go through the same normalisation as a row of a provider's file, so hours
 * written in Polish ("pn-pt 8-16"), the access and the position are read the same way everywhere.
 */
import type { z } from '@hono/zod-openapi'
import type { DeviceReport } from '../contract'
import type { DeviceSubmission } from '../db/submissions'
import type { GeocodedAddress } from '../pipeline/geocode'
import { normalizeRow } from '../pipeline/normalize'
import type { NormalizedRecord, SourceDef } from '../pipeline/types'

export type FormFields = z.infer<typeof DeviceReport>['record']

/** What a person can tell about a device by looking at it; the rest comes from the registers. */
const FORM_FIELDS = ['nazwa', 'szerokosc_geograficzna', 'dlugosc_geograficzna', 'opis_lokalizacji', 'dostep', 'godziny_dostepnosci', 'wewnatrz_budynku'] as const

/**
 * The one source every approved report joins. The operator who approved the reports answers for them, so the
 * source is published in dane.gov.pl like a provider's, with its own feed. Its kind gives it a priority below
 * official data (pipeline/types.ts), so a report never overwrites what an institution published.
 */
export const USER_SOURCE: SourceDef = {
  id: 'zgloszenia-uzytkownikow',
  kind: 'user',
  name: 'Mapa serc (zgłoszenia użytkowników)',
  attribution: 'Zgłoszenia użytkowników Mapy serc',
  licence: 'CC0 1.0',
  url: '',
  format: 'csv',
  mapping: Object.fromEntries(FORM_FIELDS.map((field) => [field, field])),
}

/** The form's values as the cells of one row, the way a provider's file would have them. */
function rowOf(fields: FormFields): Record<string, string> {
  const row: Record<string, string> = {}
  for (const field of FORM_FIELDS) {
    const value = fields[field]
    if (value === undefined || value === null) continue
    row[field] = typeof value === 'boolean' ? (value ? 'tak' : 'nie') : String(value)
  }
  return row
}

/** The report as a source record whose key is the report's id; its issues say what keeps it from the dataset. */
export function submittedRecord(id: string, fields: FormFields): NormalizedRecord {
  const row = rowOf(fields)
  const { input, fixes, issues } = normalizeRow(row, USER_SOURCE.mapping)
  return { sourceId: USER_SOURCE.id, sourceKey: id, input, raw: row, fixes, issues }
}

/** A waiting report as its source record; a copy, so completing it does not touch the report until it is saved. */
export const recordOf = (submission: DeviceSubmission): NormalizedRecord => ({
  sourceId: USER_SOURCE.id,
  sourceKey: submission.id,
  input: { ...submission.input },
  raw: { ...submission.raw },
  fixes: [...submission.fixes],
  issues: [...submission.issues],
})

/** "Szubińska 7, Białe Błota": an address point of the register as one line, the way the gaps report writes it. */
export function addressLabel(found: Pick<GeocodedAddress, 'street' | 'number' | 'city'>): string {
  return [[found.street, found.number].filter(Boolean).join(' '), found.city].filter(Boolean).join(', ')
}
