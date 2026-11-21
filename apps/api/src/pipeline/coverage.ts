/**
 * A source's data scope against the pattern ("zakres danych źródła"): which fields it delivers and for how many
 * of its rows, kept apart from what the system added from public registers.
 */
import { INPUT_FIELD_NAMES, targetFields } from '@aed/schema'
import type { NormalizedRecord, SourceDef } from './types'

export interface FieldCoverage {
  field: string
  /** Rows where the source itself gives the value: a column of its file or a constant of the whole source. */
  provided: number
  /** Rows where the system added the value from public registers (TERYT code from the point, point from the address). */
  added: number
  /** The value is a constant set for the whole source (e.g. the town of a municipal file), not a column of the file. */
  constant: boolean
}

/** Fields of one record whose value the system took from a register. */
function addedFields(record: NormalizedRecord): Set<string> {
  const added = new Set<string>()
  for (const fix of record.fixes) {
    switch (fix.code) {
      case 'geocoded_from_address':
        added.add('szerokosc_geograficzna').add('dlugosc_geograficzna')
        break
      case 'terc_from_coordinates':
        // A code that the system corrected still came from the source; only a missing one counts as added.
        if (fix.before === undefined) added.add('kod_terc')
        break
      case 'postcode_from_register':
      case 'simc_from_register':
      case 'locality_from_commune':
        if (fix.field) added.add(fix.field)
        break
    }
  }
  return added
}

export function sourceCoverage(def: SourceDef, records: NormalizedRecord[]): FieldCoverage[] {
  const columns = new Set<string>([
    ...Object.values(def.mapping).flatMap((target) => (target ? targetFields(target) : [])),
    ...(def.extract ?? []).flatMap((rule) => targetFields(rule.to)),
    ...(def.fallbackName ? ['nazwa'] : []),
  ])
  const counts = new Map(INPUT_FIELD_NAMES.map((field) => [field, { provided: 0, added: 0 }]))
  for (const record of records) {
    const added = addedFields(record)
    for (const field of INPUT_FIELD_NAMES) {
      const value = record.input[field]
      if (value === undefined || value === null || value === '') continue
      counts.get(field)![added.has(field) ? 'added' : 'provided']++
    }
  }
  return INPUT_FIELD_NAMES.map((field) => {
    const { provided, added } = counts.get(field)!
    return { field, provided, added, constant: provided > 0 && def.defaults?.[field] != null && !columns.has(field) }
  })
}
