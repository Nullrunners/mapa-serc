/** Shapes shared by the pipeline steps. No logic here. */
import type { AedInput, Licence, MappingTarget } from '@aed/schema'

export type SourceKind = 'official' | 'osm' | 'owner' | 'upload'

/** Source priority decides whose value wins when sources disagree. */
export const PRIORITY: Record<SourceKind, number> = { owner: 100, upload: 90, official: 80, osm: 40 }

/** One entry of apps/api/sources/*.json, or a source registered by the wizard. */
export interface SourceDef {
  id: string
  kind: SourceKind
  /** Who publishes it, e.g. "Urząd Miasta Krosna". */
  name: string
  /** Text of the `zrodlo` column; for CC BY sources this is the required attribution. */
  attribution: string
  licence: Licence
  /** Where the file is downloaded from. */
  url: string
  /** Human page of the dataset. */
  landingPage?: string
  /** `xlsx` and `xls` occur only for files uploaded through the wizard, whose rows are kept in the database. */
  format: 'csv' | 'geojson' | 'xlsx' | 'xls'
  /** File name of the frozen copy in test/fixtures/sources, used by tests and when the network is down. */
  fixture?: string
  /** Path of the downloaded copy under DATA_DIR/raw; defaults to "<id>.<format>". */
  snapshot?: string
  /** Column that identifies a row within the source. Without it the key is derived from name and address. */
  keyColumn?: string
  /**
   * Columns that hold the identifier a device has in another source: column → id of that source. OSM mappers
   * note the city's device number in `ref:api-um-warszawa-pl`; such a pair is one device whatever its names say.
   */
  refs?: Record<string, string>
  /**
   * Columns to take the place name from, in order, when the mapped name is empty (OSM rarely names an AED).
   * Only columns that name a place belong here: words about the spot ("przy wejściu") are a description, not a
   * name. A record that none of them names is called UNNAMED_PLACE and goes by its address.
   */
  fallbackName?: string[]
  /**
   * A submission that an operator has not approved yet. Its records are kept and shown to the provider, but they
   * do not enter the files for dane.gov.pl and cannot change records that are already published.
   */
  pending?: boolean
  /** Reviewed column mapping: header as it appears in the file (trimmed) → target, or null to ignore the column. */
  mapping: Record<string, MappingTarget | null>
  /** Values that hold for every row of this source and are not in the file. */
  defaults?: AedInput
  /** Column whose value is cut out of another with a regular expression, e.g. the device number inside a name. */
  extract?: { from: string; to: MappingTarget; pattern: string }[]
  /** Text to strip from values of a column, as regular expressions (e.g. "Defibrylator (AED 1234) w "). */
  strip?: { column: string; pattern: string }[]
}

export interface RawTable {
  headers: string[]
  rows: Record<string, string>[]
  /** What the parser had to repair to read the file at all (encoding, whole-line quotes …). */
  fixes: Fix[]
}

export type FixCode =
  | 'encoding_windows_1250'
  | 'bom_removed'
  | 'whole_line_quoted'
  | 'sheet_selected'
  | 'header_trimmed'
  | 'coordinates_swapped'
  | 'decimal_comma'
  | 'coordinates_dms'
  | 'coordinates_puwg1992'
  | 'coordinates_puwg2000'
  | 'address_split'
  | 'postcode_format'
  | 'phone_format'
  | 'date_format'
  | 'value_mapped'
  | 'whitespace'
  | 'terc_from_coordinates'
  | 'geocoded_from_address'
  | 'postcode_from_register'
  | 'simc_from_register'
  | 'locality_from_commune'
  | 'address_from_coordinates'
  | 'locality_from_register'
  | 'locality_from_file'

export type IssueCode =
  | 'coordinates_missing'
  | 'coordinates_invalid'
  | 'coordinates_outside_poland'
  | 'coordinates_duplicate_in_source'
  | 'address_point_mismatch'
  | 'name_missing'
  | 'value_not_recognised'
  | 'personal_data_suspected'
  | 'required_missing'

/** Something the system changed on its own; shown to the provider so that they can fix the source file. */
export interface Fix {
  code: FixCode
  field?: string
  message: string
  before?: string
  after?: string
}

/** Something the system could not repair. `error` keeps the record out of the national file. */
export interface Issue {
  code: IssueCode
  severity: 'error' | 'warning'
  field?: string
  message: string
}

/** One row of a source after normalisation, before it meets other sources. */
export interface NormalizedRecord {
  sourceId: string
  /** Identifier of the row within its source; stable between downloads. */
  sourceKey: string
  input: AedInput
  raw: Record<string, string>
  fixes: Fix[]
  issues: Issue[]
}
