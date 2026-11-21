/**
 * Builds one national record out of the source records that describe the same device, with the origin of
 * every field, the licence the result may be published under, and a quality score.
 */
import { createHash } from 'node:crypto'
import { FIELD_NAMES, type AedFieldName, type AedInput, type AedRecord, type Licence } from '@aed/schema'
import { PRIORITY, type Issue, type NormalizedRecord, type SourceDef } from './types'

/**
 * official   first-party or official data under a Creative Commons licence: goes into the file for dane.gov.pl
 * community  known only from OpenStreetMap (ODbL): shown as "unconfirmed", kept out of the portal file
 * pending    submitted through the wizard and waiting for an operator's approval
 * incomplete a required field is missing (usually the position): waits for the provider or the geocoder
 */
export type Publication = 'official' | 'community' | 'pending' | 'incomplete'

export interface SourceRef {
  sourceId: string
  sourceKey: string
  /** values = supplied field values; corroborates = only confirms the device exists; pending = waits for approval. */
  role: 'values' | 'corroborates' | 'pending'
}

export interface MergedAed {
  id: string
  publication: Publication
  /** Complete when publication is not "incomplete"; otherwise the required fields that are known. */
  record: AedRecord
  /** field → id of the source the value came from. */
  provenance: Partial<Record<AedFieldName, string>>
  sources: SourceRef[]
  quality: number
  issues: Issue[]
}

const SYSTEM_FIELDS = new Set<AedFieldName>(['id', 'zrodlo', 'licencja', 'data_aktualizacji'])
const REQUIRED_FROM_SOURCES: AedFieldName[] = ['nazwa', 'miejscowosc', 'kod_terc', 'szerokosc_geograficzna', 'dlugosc_geograficzna']

/** Deterministic UUID (version 5 layout) so that rebuilding the database from scratch yields the same ids. */
export function stableId(sourceId: string, sourceKey: string): string {
  const hash = createHash('sha1').update(`aed-hub:${sourceId}:${sourceKey}`).digest('hex')
  const variant = ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(18, 20)}-${hash.slice(20, 32)}`
}

export const memberKey = (record: { sourceId: string; sourceKey: string }) => `${record.sourceId}\u0000${record.sourceKey}`

const MONTH_MS = 30.44 * 24 * 3600 * 1000

/** 0–100: how much a rescuer and a re-user can rely on the record. */
export function qualityScore(record: AedRecord, sourceCount: number, warnings: number, today: string): number {
  let score = 40
  if (record.dostep) score += 8
  if (record.godziny_dostepnosci) score += 10
  if (record.opis_lokalizacji) score += 8
  if (record.podmiot_odpowiedzialny) score += 6
  if (record.nazwa_ulicy || record.nr_budynku) score += 3
  if (record.telefon_kontaktowy || record.email_kontaktowy) score += 5
  if (record.data_weryfikacji) {
    const months = (Date.parse(today) - Date.parse(record.data_weryfikacji)) / MONTH_MS
    score += months <= 12 ? 15 : months <= 24 ? 9 : 4
  }
  if (sourceCount >= 2) score += 5
  score -= Math.min(15, warnings * 5)
  return Math.max(0, Math.min(100, Math.round(score)))
}

export interface MergeContext {
  sources: Map<string, SourceDef>
  /** member key → id the device already has in the national dataset. */
  existingIds: Map<string, string>
  today: string
}

export function mergeCluster(members: NormalizedRecord[], context: MergeContext): MergedAed {
  const priorityOf = (member: NormalizedRecord) => PRIORITY[context.sources.get(member.sourceId)!.kind]
  const ordered = [...members].sort(
    (a, b) =>
      priorityOf(b) - priorityOf(a) ||
      (b.input.data_weryfikacji ?? '').localeCompare(a.input.data_weryfikacji ?? '') ||
      memberKey(a).localeCompare(memberKey(b)),
  )

  // OSM (ODbL) never supplies values to a record that has an official or owner source: the result must stay
  // publishable under a Creative Commons licence. There OSM only confirms the device exists.
  // An unapproved submission must not change what is already published: next to approved sources it is ignored
  // until an operator approves it. A device known only from unapproved submissions is "pending".
  const approved = ordered.filter((member) => !context.sources.get(member.sourceId)!.pending)
  const trusted = approved.length > 0 ? approved : ordered
  const hasOpenSource = trusted.some((member) => context.sources.get(member.sourceId)!.kind !== 'osm')
  const contributors = hasOpenSource ? trusted.filter((member) => context.sources.get(member.sourceId)!.kind !== 'osm') : trusted

  const values: Record<string, unknown> = {}
  const provenance: Partial<Record<AedFieldName, string>> = {}
  for (const field of FIELD_NAMES) {
    if (SYSTEM_FIELDS.has(field)) continue
    for (const member of contributors) {
      const value = member.input[field as keyof AedInput]
      if (value === undefined || value === null || value === '') continue
      values[field] = value
      provenance[field] = member.sourceId
      break
    }
  }

  const used = new Set(Object.values(provenance))
  const usedDefs = contributors.filter((member) => used.has(member.sourceId)).map((member) => context.sources.get(member.sourceId)!)
  const licences = new Set(usedDefs.map((def) => def.licence))
  const licence: Licence = licences.has('ODbL 1.0') ? 'ODbL 1.0' : licences.has('CC BY 4.0') ? 'CC BY 4.0' : 'CC0 1.0'

  const anchor = ordered[0]!
  const known = ordered.map((member) => context.existingIds.get(memberKey(member))).find((id) => id !== undefined)
  const id = known ?? stableId(anchor.sourceId, anchor.sourceKey)

  const record = Object.fromEntries(FIELD_NAMES.map((field) => [field, values[field] ?? null])) as unknown as AedRecord
  record.id = id
  record.status = (values.status as AedRecord['status'] | undefined) ?? 'nieznany'
  record.zrodlo = [...new Set(usedDefs.map((def) => def.attribution))].join('; ')
  record.licencja = licence
  record.data_aktualizacji = context.today

  const issues = contributors.flatMap((member) => member.issues)
  // The unconfirmed OSM layer is shown by position only; its commune codes arrive later from a slower job.
  const required = hasOpenSource ? REQUIRED_FROM_SOURCES : REQUIRED_FROM_SOURCES.filter((field) => field !== 'kod_terc' && field !== 'miejscowosc')
  const missing = required.filter((field) => values[field] === undefined)
  if (missing.length > 0) {
    issues.push({ code: 'required_missing', severity: 'error', message: `Brakuje pól wymaganych: ${missing.join(', ')}.` })
  }
  const blocked = issues.some((issue) => issue.severity === 'error')
  const publication: Publication = blocked ? 'incomplete' : approved.length === 0 ? 'pending' : hasOpenSource ? 'official' : 'community'

  return {
    id,
    publication,
    record,
    provenance,
    sources: ordered.map((member) => ({
      sourceId: member.sourceId,
      sourceKey: member.sourceKey,
      role: contributors.includes(member) ? 'values' : trusted.includes(member) ? 'corroborates' : 'pending',
    })),
    quality: qualityScore(record, ordered.length, issues.filter((issue) => issue.severity === 'warning').length, context.today),
    issues,
  }
}
