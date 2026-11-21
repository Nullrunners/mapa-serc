/**
 * Provider wizard: read a file in any layout, propose the column mapping, show every fix and problem,
 * and on commit keep the file as a source of the national dataset.
 *
 * A submission made without the operator token is stored as "pending": the provider sees the result, but the
 * records enter the files for dane.gov.pl only after an operator approves the source. In production the token
 * is replaced by the provider's identity (login.gov.pl); the rule stays the same.
 */
import { createHash } from 'node:crypto'
import type { RouteHandler } from '@hono/zod-openapi'
import { COMPOSITE_TARGETS, FIELD_NAMES, type AedRecord, type MappingTarget } from '@aed/schema'
import { config } from './config'
import { getContext } from './context'
import type { ImportRequest, approveSourceRoute, importCommitRoute, importPreviewRoute, sourceCsvRoute } from './contract'
import type { Store } from './db/store'
import { ApiError } from './http/errors'
import { runJob } from './jobs'
import { compare } from './pipeline/dedup'
import { enrich } from './pipeline/geocode'
import { suggestMapping, toMapping, type ColumnSuggestion } from './pipeline/mapping'
import { parseAny } from './pipeline/parse'
import { checkSource, normalizeSource } from './pipeline/sources'
import { PRIORITY, type NormalizedRecord, type RawTable, type SourceDef } from './pipeline/types'
import { isLegacyXls, isXlsx, parseXls, parseXlsx } from './pipeline/xlsx'
import { toCsv } from './publish/files'
import { deviceName } from './passport/service'
import { ownerUrl, passportUrl, stickerUrl, verifyInvitation } from './radar/links'
import type { z } from '@hono/zod-openapi'

const MAX_FILE_BYTES = 5 * 1024 * 1024
/** Rows looked up in the registers and returned by a preview; a commit processes the whole file. */
const PREVIEW_ROWS = 300

const TARGETS = new Set<string>([...FIELD_NAMES, ...COMPOSITE_TARGETS])
/** Fields the system fills in itself; a provider's column cannot be mapped to them. */
const SYSTEM_FIELDS = new Set(['id', 'zrodlo', 'licencja', 'data_aktualizacji'])

type Request = z.infer<typeof ImportRequest>

interface Prepared {
  def: SourceDef
  records: NormalizedRecord[]
  columns: ColumnSuggestion[]
  format: SourceDef['format']
  fileFixes: RawTable['fixes']
  table: RawTable & { format: SourceDef['format'] }
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

/** The same provider uploading the same file name again replaces the earlier submission instead of doubling it. */
const sourceIdFor = (providerName: string, fileName: string) =>
  `upload-${slug(providerName) || 'dostawca'}-${createHash('sha1').update(`${providerName}|${fileName}`).digest('hex').slice(0, 8)}`

async function prepare(request: Request, pending: boolean): Promise<Prepared> {
  const bytes = Buffer.from(request.contentBase64, 'base64')
  if (bytes.length === 0) throw new ApiError(400, 'file_unreadable', 'Plik jest pusty.')
  if (bytes.length > MAX_FILE_BYTES) throw new ApiError(400, 'file_unreadable', 'Plik jest większy niż 5 MB. Podziel go na części albo podaj adres zbioru.')

  let table: Prepared['table']
  try {
    table = isXlsx(bytes) ? { ...(await parseXlsx(bytes)), format: 'xlsx' } : isLegacyXls(bytes) ? { ...parseXls(bytes), format: 'xls' } : parseAny(bytes)
  } catch {
    throw new ApiError(400, 'file_unreadable', 'Nie udało się odczytać pliku. Obsługiwane formaty to Excel (.xlsx i .xls), CSV i GeoJSON.')
  }
  if (table.rows.length === 0 || table.headers.length < 2) {
    throw new ApiError(400, 'file_unreadable', 'W pliku nie ma tabeli z danymi: potrzebny jest wiersz nagłówka i co najmniej jeden wiersz z urządzeniem.')
  }

  const suggestions = suggestMapping(table)
  let columns = suggestions
  if (request.mapping) {
    const issues = Object.entries(request.mapping)
      .filter(([header, target]) => !table.headers.includes(header) || (target !== null && (!TARGETS.has(target) || SYSTEM_FIELDS.has(target))))
      .map(([header, target]) => ({ path: `mapping.${header}`, message: table.headers.includes(header) ? `Nieznane pole wzorca: ${target}.` : 'W pliku nie ma takiej kolumny.' }))
    if (issues.length > 0) throw new ApiError(422, 'validation_error', 'Dopasowanie kolumn odwołuje się do nieznanych kolumn lub pól.', issues)
    columns = suggestions.map((suggestion) => {
      if (!(suggestion.header in request.mapping!)) return { ...suggestion, target: null, confidence: 1, reason: 'kolumna pominięta' }
      const chosen = request.mapping![suggestion.header] as MappingTarget | null
      return chosen === suggestion.target ? suggestion : { ...suggestion, target: chosen, confidence: 1, reason: 'wybór użytkownika' }
    })
  }

  const providerName = request.provider?.name.trim() || 'Podgląd'
  const def: SourceDef = {
    id: sourceIdFor(providerName, request.fileName),
    kind: 'upload',
    name: providerName,
    attribution: `${providerName} (zgłoszenie w AED Hub)`,
    licence: request.provider?.licence ?? 'CC0 1.0',
    url: '',
    format: table.format,
    mapping: toMapping(columns),
    ...(pending ? { pending: true } : {}),
  }
  const records = normalizeSource(def, table)
  checkSource(def, records)
  return { def, records, columns, format: table.format, fileFixes: table.fixes, table }
}

/** The device the system already knows that a row most likely describes. */
function findDuplicate(record: NormalizedRecord, store: Store) {
  const { szerokosc_geograficzna: lat, dlugosc_geograficzna: lon } = record.input
  if (lat == null || lon == null) return null
  const item = { index: -1, sourceId: record.sourceId, priority: PRIORITY.upload, lat, lon, name: record.input.nazwa ?? '', street: record.input.nazwa_ulicy ?? '', number: record.input.nr_budynku ?? '' }
  let best: { id: string; nazwa: string; distanceM: number; decision: 'auto' | 'review'; publication: 'official' | 'community'; score: number } | null = null
  for (const aed of store.aeds) {
    if (aed.publication !== 'official' && aed.publication !== 'community') continue
    const other = aed.record
    // Cheap box test first: 0.002° is more than the 150 m the comparison allows.
    if (Math.abs(other.szerokosc_geograficzna - lat) > 0.002 || Math.abs(other.dlugosc_geograficzna - lon) > 0.004) continue
    // A re-upload of the same file must not report its own earlier copy as a duplicate.
    if (aed.sources.every((ref) => ref.sourceId === record.sourceId)) continue
    const comparison = compare(item, { index: 0, sourceId: 'national', priority: 0, lat: other.szerokosc_geograficzna, lon: other.dlugosc_geograficzna, name: other.nazwa, street: other.nazwa_ulicy ?? '', number: other.nr_budynku ?? '' })
    if (comparison.decision === 'different') continue
    // An official match matters more to the provider than a community one at the same score.
    const score = comparison.score + (aed.publication === 'official' ? 0.05 : 0)
    if (!best || score > best.score) best = { id: aed.id, nazwa: other.nazwa, distanceM: comparison.distanceM, decision: comparison.decision, publication: aed.publication, score }
  }
  if (!best) return null
  const { score: _score, ...duplicate } = best
  return duplicate
}

export const importPreviewHandler: RouteHandler<typeof importPreviewRoute> = async (c) => {
  const { store, geo } = await getContext()
  const prepared = await prepare(c.req.valid('json'), true)
  const shown = prepared.records.slice(0, PREVIEW_ROWS)
  await enrich(shown, geo)

  const rows = shown.map((record, index) => ({ index, record: record.input as Record<string, unknown>, fixes: record.fixes, issues: record.issues, duplicateOf: findDuplicate(record, store) }))
  const hasError = (row: (typeof rows)[number]) => row.issues.some((issue) => issue.severity === 'error') || row.record.szerokosc_geograficzna == null
  return c.json(
    {
      stub: false,
      format: prepared.format,
      fileFixes: prepared.fileFixes,
      columns: prepared.columns,
      rows,
      summary: {
        rows: prepared.records.length,
        ready: rows.filter((row) => !hasError(row)).length,
        withFixes: rows.filter((row) => row.fixes.length > 0).length,
        withErrors: rows.filter(hasError).length,
        duplicates: rows.filter((row) => row.duplicateOf !== null).length,
      },
    },
    200,
  )
}

/** What became of a source's rows after a merge. */
function outcome(store: Store, sourceId: string) {
  const own = store.aeds.filter((aed) => aed.sources.some((ref) => ref.sourceId === sourceId))
  const isOther = (ref: { sourceId: string }) => ref.sourceId !== sourceId && !ref.sourceId.startsWith('osm')
  return {
    added: own.filter((aed) => aed.publication !== 'incomplete' && !aed.sources.some(isOther)).length,
    merged: own.filter((aed) => aed.publication !== 'incomplete' && aed.sources.some(isOther)).length,
    incomplete: own.filter((aed) => aed.publication === 'incomplete').length,
  }
}

/** Published devices of a submission with the links its keeper needs: passport management and the sticker. */
function deviceLinks(store: Store, sourceId: string) {
  return store.aeds
    .filter((aed) => aed.publication === 'official' && aed.sources.some((ref) => ref.sourceId === sourceId && ref.role === 'values'))
    .map((aed) => ({ id: aed.id, name: deviceName(aed.record), ownerUrl: ownerUrl(aed.id, store.passports.get(aed.id)?.linkVersion ?? 0), passportUrl: passportUrl(aed.id), stickerUrl: stickerUrl(aed.id) }))
}

const files = (sourceId: string) => ({ csv: `${config.publicApiUrl}/v1/sources/${sourceId}/aed.csv`, report: `${config.publicApiUrl}/v1/sources` })

export const importCommitHandler: RouteHandler<typeof importCommitRoute> = async (c) => {
  const request = c.req.valid('json')
  if (!request.provider) {
    throw new ApiError(422, 'validation_error', 'Do zapisania zgłoszenia potrzebna jest nazwa dostawcy.', [{ path: 'provider', message: 'Podaj nazwę instytucji, która zgłasza urządzenia.' }])
  }
  const { store } = await getContext()
  // Published at once when an operator sends it, or when it answers an operator's invitation; otherwise it waits.
  const invitedBy = request.invitation ? verifyInvitation(request.invitation) : null
  // Only a lead the operator invited (or already confirmed) can stand behind an invitation; a rejected one cannot.
  const lead = invitedBy === null ? undefined : store.candidates.find((candidate) => candidate.id === invitedBy && (candidate.status === 'invited' || candidate.status === 'confirmed'))
  if (request.invitation && !lead) throw new ApiError(422, 'validation_error', 'Link zaproszenia jest nieprawidłowy albo uszkodzony. Otwórz go ponownie z wiadomości od operatora.', [{ path: 'invitation', message: 'Nieprawidłowy token zaproszenia.' }])
  const approved = lead !== undefined || (config.adminToken !== '' && c.req.header('Authorization') === `Bearer ${config.adminToken}`)
  const prepared = await prepare(request, !approved)

  await store.saveStoredSource(prepared.def, prepared.records)
  await store.log({ actor: prepared.def.name, entity: 'source', entityId: prepared.def.id, action: approved ? 'import_published' : 'import_submitted', detail: { fileName: request.fileName, rows: prepared.records.length, licence: prepared.def.licence } })
  await runJob('pipeline')
  if (lead) await store.setCandidateStatus(lead.id, 'confirmed')

  return c.json(
    { stub: false, status: approved ? ('published' as const) : ('pending' as const), sourceId: prepared.def.id, ...outcome(store, prepared.def.id), files: files(prepared.def.id), devices: approved ? deviceLinks(store, prepared.def.id) : [] },
    200,
  )
}

export const approveSourceHandler: RouteHandler<typeof approveSourceRoute> = async (c) => {
  const { id } = c.req.valid('param')
  if (config.adminToken === '' || c.req.header('Authorization') !== `Bearer ${config.adminToken}`) {
    throw new ApiError(401, 'unauthorized', 'This action needs the operator token: Authorization: Bearer <ADMIN_TOKEN>.')
  }
  const { store } = await getContext()
  if (!(await store.approveSource(id))) throw new ApiError(404, 'not_found', `No submission with id ${id}.`)
  await store.log({ actor: 'operator', entity: 'source', entityId: id, action: 'import_approved', detail: {} })
  await runJob('pipeline')
  return c.json({ stub: false, status: 'published' as const, sourceId: id, ...outcome(store, id), files: files(id), devices: deviceLinks(store, id) }, 200)
}

/** A provider's own devices in the data pattern, whatever their publication state. */
export const sourceCsvHandler: RouteHandler<typeof sourceCsvRoute> = async (c) => {
  const { id } = c.req.valid('param')
  const { store } = await getContext()
  if (!store.reports.some((report) => report.id === id)) throw new ApiError(404, 'not_found', `No source with id ${id}.`)
  const records: AedRecord[] = store.aeds
    // Only devices whose values come from this source: a record built from someone else's data is not theirs to publish.
    .filter((aed) => aed.publication !== 'incomplete' && aed.sources.some((ref) => ref.sourceId === id && ref.role === 'values'))
    .map((aed) => aed.record)
    .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl') || a.id.localeCompare(b.id))
  return c.body(toCsv(records), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="aed-${id}.csv"` })
}
