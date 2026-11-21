/**
 * The public contract: Zod schemas and route definitions only. No logic, no imports from the rest of the API.
 * openapi/openapi.json is generated from this file (pnpm contract); the web app generates its client from that.
 *
 * Conventions: a device record uses the column names of the data pattern (Polish, snake_case), exactly as in the
 * published CSV. Everything around it is camelCase. A missing value is null; fields are never omitted.
 */
import { createRoute, z } from '@hono/zod-openapi'
import { ACCESS_METHODS, FIELDS, STATUS, type FieldDef } from '@aed/schema'

// ---------------------------------------------------------------- building blocks

export const Problem = z
  .object({
    type: z.string().openapi({ example: 'urn:aed-hub:problem:not_found' }),
    title: z.string(),
    status: z.number().int(),
    code: z.enum(['validation_error', 'not_found', 'unauthorized', 'file_unreadable', 'conflict', 'unavailable', 'internal_error']),
    detail: z.string().nullable(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  })
  .openapi('Problem')

const json = <S extends z.ZodType>(schema: S, description: string) => ({ description, content: { 'application/json': { schema } } })
const file = (mediaType: string, description: string) => ({ description, content: { [mediaType]: { schema: z.string() } } })
const problem = (description: string) => ({ description, content: { 'application/problem+json': { schema: Problem } } })
const problems = { 422: problem('The request does not match the contract'), 500: problem('Unexpected error') }
const operatorOnly = { security: [{ operatorToken: [] }], responses401: { 401: problem('Missing or wrong operator token') } }

/** Fields a record may lack while it is known only from OpenStreetMap. */
const NULLABLE_REQUIRED = new Set(['kod_terc', 'miejscowosc'])

function fieldSchema(field: FieldDef) {
  const base = field.enum
    ? z.enum(field.enum as [string, ...string[]])
    : field.type === 'number'
      ? z.number()
      : field.type === 'boolean'
        ? z.boolean()
        : z.string()
  const described = base.openapi({ description: field.description, example: field.example })
  return field.requirement === 'required' && !NULLABLE_REQUIRED.has(field.name) ? described : described.nullable()
}

/** One device, with exactly the columns of the data pattern. Generated from the field catalogue in @aed/schema. */
export const AedRecord = z.object(Object.fromEntries((FIELDS as readonly FieldDef[]).map((field) => [field.name, fieldSchema(field)]))).openapi('AedRecord', {
  description: 'Rekord urządzenia w układzie wzorca danych AED – te same kolumny co w pliku CSV dla dane.gov.pl.',
})

export const Publication = z.enum(['official', 'community', 'pending', 'incomplete']).openapi('Publication', {
  description:
    'official = dane od opiekuna lub ze zbioru urzędowego, trafia do pliku dla dane.gov.pl. community = znane tylko z OpenStreetMap (ODbL), niepotwierdzone. pending = zgłoszenie z kreatora czeka na zatwierdzenie przez operatora. incomplete = brakuje pola wymaganego, zwykle położenia.',
})

export const Layer = z.enum(['official', 'community', 'all']).openapi('Layer')

const FixSchema = z
  .object({ code: z.string(), field: z.string().optional(), message: z.string(), before: z.string().optional(), after: z.string().optional() })
  .openapi('Fix', { description: 'Poprawka, którą system wprowadził sam.' })

const IssueSchema = z
  .object({ code: z.string(), severity: z.enum(['error', 'warning']), field: z.string().optional(), message: z.string() })
  .openapi('Issue', { description: 'Problem, którego system nie naprawił. „error" wstrzymuje publikację rekordu.' })

export const Reach = z
  .object({
    state: z.enum(['open', 'likely_open', 'unknown', 'closed']).openapi({
      description: 'open = godziny obejmują tę chwilę; likely_open = szafka na zewnątrz bez podanych godzin; unknown = nie wiadomo; closed = poza godzinami, wycofane albo tylko dla personelu',
    }),
    etaS: z.number().int().nullable().openapi({ description: 'Szacowany czas do urządzenia w ręku, w sekundach: dojście i czas na miejscu. null, gdy teraz niedostępne' }),
    walkS: z.number().int(),
    accessS: z.number().int().openapi({ description: 'Czas stracony na miejscu: szafka z kodem, recepcja, piętra' }),
    method: z.enum(ACCESS_METHODS).nullable(),
    methodGuessed: z.boolean().openapi({ description: 'true, gdy sposób dostępu odczytano z opisu, a nie z pola sposob_dostepu' }),
    change: z
      .object({ open: z.boolean(), minutes: z.number().int(), time: z.string(), days: z.number().int() })
      .nullable()
      .openapi({ description: 'Najbliższa zmiana: do której czynne albo od kiedy (czas lokalny, days = 0 dziś, 1 jutro)' }),
    reasons: z.array(
      z.enum(['hours_24_7', 'hours_open', 'hours_closed', 'outdoor_no_hours', 'no_hours', 'assumed_closed', 'staff_only', 'out_of_service', 'method_free', 'method_alarm', 'method_code', 'method_staff', 'outdoor', 'floor', 'reported_problem']),
    ),
    score: z.number().int().openapi({ description: 'Klucz sortowania w sekundach (mniej = lepiej)' }),
  })
  .openapi('Reach', { description: 'Dostępny TERAZ: czy i jak szybko da się wyjąć urządzenie w tej minucie.' })

export const AedItem = z
  .object({
    id: z.string(),
    publication: Publication,
    quality: z.number().int().min(0).max(100).openapi({ description: 'Ocena jakości rekordu 0–100' }),
    distanceM: z.number().int().nullable().openapi({ description: 'Odległość od punktu z parametru `near`, w metrach' }),
    availableNow: z.enum(['yes', 'no', 'unknown']).openapi({
      description:
        'Czy przechodzień dostanie się do urządzenia w chwili zapytania: no = poza godzinami dostępności, wycofane, czasowo niedostępne albo tylko dla personelu; unknown = rekord nie podaje godzin dostępności albo podaje je w zapisie, którego system nie rozumie.',
    }),
    record: AedRecord,
    reach: Reach.optional().openapi({ description: 'Przy zapytaniu z parametrem near: dostępność w tej chwili i szacowany czas do urządzenia' }),
  })
  .openapi('AedItem')

// ---------------------------------------------------------------------- meta

export const HealthResponse = z
  .object({
    status: z.literal('ok'),
    version: z.string(),
    pipelineRanAt: z.string().nullable().openapi({ description: 'When the sources were last merged; null before the first run' }),
    counts: z.object({ official: z.number().int(), community: z.number().int(), pending: z.number().int(), incomplete: z.number().int() }),
    endpoints: z.record(z.string(), z.enum(['stub', 'live'])).openapi({ description: 'operationId → stub | live' }),
    time: z.string(),
  })
  .openapi('HealthResponse')

export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  tags: ['meta'],
  summary: 'Liveness, dataset size and per-endpoint implementation status',
  responses: { 200: json(HealthResponse, 'Service is up'), ...problems },
})

// ---------------------------------------------------------------------- data

export const AedListQuery = z.object({
  layer: Layer.default('official').openapi({ description: 'Which devices: official (default), community (OSM only) or all' }),
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .optional()
    .openapi({ description: 'minLon,minLat,maxLon,maxLat', example: '20.8,52.3,21.2,52.5' }),
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional()
    .openapi({ description: 'lat,lon – sorts by distance and fills distanceM', example: '52.3267,21.1076' }),
  radiusM: z.coerce.number().int().min(1).max(100_000).optional().openapi({ description: 'With `near`: only devices within this distance' }),
  terc: z
    .string()
    .regex(/^\d{2,7}$/)
    .optional()
    .openapi({ description: 'TERC prefix: 2 digits = województwo, 4 = powiat, 7 = gmina', example: '1434021' }),
  q: z.string().max(100).optional().openapi({ description: 'Text to find in the name, street or locality' }),
  availableNow: z.enum(['true', 'false']).optional().openapi({ description: 'true = only devices a passer-by can reach right now (see `availableNow` of a device)' }),
  sort: z.enum(['distance', 'reach']).default('distance').openapi({ description: 'With `near`: distance = nearest first; reach = soonest in hand at this minute (hours, holidays, cabinet, floor)' }),
  at: z.iso.datetime({ offset: true }).optional().openapi({ description: 'Moment to check instead of now, e.g. 2026-11-22T03:00:00+01:00', example: '2026-11-22T03:00:00+01:00' }),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

export const AedListResponse = z.object({ total: z.number().int(), items: z.array(AedItem) }).openapi('AedListResponse')

export const aedListRoute = createRoute({
  method: 'get',
  path: '/v1/aed',
  operationId: 'listAed',
  tags: ['data'],
  summary: 'Devices, filtered by area, commune, text or distance from a point',
  request: { query: AedListQuery },
  responses: { 200: json(AedListResponse, 'Matching devices'), ...problems },
})

export const AedDetail = AedItem.extend({
  provenance: z.record(z.string(), z.string()).openapi({ description: 'pole → identyfikator źródła, z którego pochodzi wartość' }),
  sources: z.array(
    z.object({
      sourceId: z.string(),
      sourceKey: z.string(),
      name: z.string(),
      licence: z.string(),
      role: z.enum(['values', 'corroborates', 'pending']).openapi({ description: 'values = dostarcza wartości pól; corroborates = tylko potwierdza istnienie urządzenia; pending = zgłoszenie czeka na zatwierdzenie' }),
    }),
  ),
  issues: z.array(IssueSchema),
  history: z.array(z.object({ at: z.string(), actor: z.string(), action: z.string(), detail: z.unknown() })),
}).openapi('AedDetail')

export const aedDetailRoute = createRoute({
  method: 'get',
  path: '/v1/aed/{id}',
  operationId: 'getAed',
  tags: ['data'],
  summary: 'One device with the origin of every field and its change history',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: json(AedDetail, 'The device'), 404: problem('No device with this id'), ...problems },
})

export const MapFeatureCollection = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(
      z.object({
        type: z.literal('Feature'),
        geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
        properties: z.object({
          id: z.string(),
          nazwa: z.string(),
          publication: Publication,
          dostep: z.string().nullable(),
          godziny_dostepnosci: z.string().nullable(),
          status: z.string(),
          quality: z.number().int(),
        }),
      }),
    ),
  })
  .openapi('MapFeatureCollection')

export const mapRoute = createRoute({
  method: 'get',
  path: '/v1/aed.geojson',
  operationId: 'getMapLayer',
  tags: ['data'],
  summary: 'All devices of a layer as a slim GeoJSON for the map (a MapLibre source with clustering)',
  request: { query: z.object({ layer: Layer.default('all') }) },
  responses: { 200: json(MapFeatureCollection, 'Points with the few properties the map needs'), ...problems },
})

export const StatsResponse = z
  .object({
    pipelineRanAt: z.string().nullable(),
    official: z.number().int(),
    community: z.number().int(),
    pending: z.number().int(),
    incomplete: z.number().int(),
    averageQuality: z.number().nullable().openapi({ description: 'Average quality score of official records' }),
    reviewPairs: z.number().int().openapi({ description: 'Pairs of records that may be the same device and wait for a decision' }),
    byVoivodeship: z.array(z.object({ terc: z.string(), name: z.string(), official: z.number().int(), community: z.number().int() })),
    communesWithOfficial: z.number().int().openapi({ description: 'Communes with at least one official record' }),
    communesTotal: z.number().int().openapi({ description: 'Communes in Poland', example: 2479 }),
  })
  .openapi('StatsResponse')

export const statsRoute = createRoute({
  method: 'get',
  path: '/v1/stats',
  operationId: 'getStats',
  tags: ['data'],
  summary: 'Size and coverage of the national dataset',
  responses: { 200: json(StatsResponse, 'Counts'), ...problems },
})

const ReportLine = z.object({ code: z.string(), count: z.number().int(), example: z.string() })

const FieldCoverage = z
  .object({
    field: z.string().openapi({ description: 'Nazwa pola wzorca', example: 'godziny_dostepnosci' }),
    provided: z.number().int().openapi({ description: 'Wiersze, w których wartość daje samo źródło' }),
    added: z.number().int().openapi({ description: 'Wiersze, w których wartość uzupełnił system z rejestrów państwowych (TERYT, adresy)' }),
    constant: z.boolean().openapi({ description: 'Wartość jest stała dla całego źródła (np. miejscowość w pliku jednej gminy), a nie kolumną pliku' }),
  })
  .openapi('FieldCoverage')

export const SourceReport = z
  .object({
    id: z.string(),
    kind: z.enum(['official', 'osm', 'owner', 'upload']),
    awaitingApproval: z.boolean().openapi({ description: 'Zgłoszenie z kreatora, którego operator jeszcze nie zatwierdził' }),
    name: z.string(),
    attribution: z.string(),
    licence: z.string(),
    url: z.string(),
    landingPage: z.string().nullable(),
    origin: z.enum(['network', 'snapshot', 'fixture', 'database', 'missing']).openapi({ description: 'Where the file was read from in the last run' }),
    error: z.string().nullable(),
    readAt: z.string(),
    rows: z.number().int(),
    official: z.number().int(),
    community: z.number().int(),
    pending: z.number().int(),
    incomplete: z.number().int(),
    fileFixes: z.array(FixSchema),
    fixes: z.array(ReportLine),
    issues: z.array(ReportLine.extend({ severity: z.enum(['error', 'warning']) })),
    coverage: z.array(FieldCoverage).openapi({ description: 'Zakres danych źródła względem wzorca: jedna pozycja na każde pole, które źródło może dostarczyć' }),
  })
  .openapi('SourceReport', { description: 'Raport jakości dla dostawcy: co odczytano, co poprawiono, czego nie udało się naprawić.' })

export const KnownSource = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    licence: z.string().nullable().openapi({ description: 'null, gdy źródło nie podaje licencji' }),
    devices: z.number().int().nullable().openapi({ description: 'Liczba urządzeń według samego źródła; null, gdy nieznana' }),
    scope: z.string().openapi({ description: 'Co wiadomo o zakresie danych źródła' }),
    reason: z.string().openapi({ description: 'Dlaczego źródło nie jest włączone do zbioru' }),
  })
  .openapi('KnownSource', { description: 'Źródło danych o AED, które znamy, ale którego nie włączamy do zbioru krajowego.' })

export const sourcesRoute = createRoute({
  method: 'get',
  path: '/v1/sources',
  operationId: 'listSources',
  tags: ['data'],
  summary: 'Every source of the national dataset with its quality report and data scope; known sources that are not merged in',
  responses: { 200: json(z.object({ items: z.array(SourceReport), notIncluded: z.array(KnownSource) }).openapi('SourceList'), 'Sources'), ...problems },
})

export const SchemaResponse = z
  .object({
    name: z.string(),
    title: z.string(),
    version: z.string(),
    groups: z.array(z.object({ id: z.string(), title: z.string() })),
    fields: z.array(
      z.object({
        name: z.string(),
        group: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'date']),
        requirement: z.enum(['required', 'recommended', 'optional']),
        title: z.string(),
        description: z.string(),
        example: z.union([z.string(), z.number(), z.boolean()]),
        enum: z.array(z.string()).nullable(),
        enumLabels: z.array(z.string()).nullable(),
        pattern: z.string().nullable(),
        osm: z.string().nullable(),
        geoDae: z.string().nullable(),
      }),
    ),
  })
  .openapi('SchemaResponse')

export const schemaRoute = createRoute({
  method: 'get',
  path: '/v1/schema',
  operationId: 'getSchema',
  tags: ['data'],
  summary: 'The data pattern as a field catalogue (drives the documentation page and the forms)',
  responses: { 200: json(SchemaResponse, 'Field catalogue'), ...problems },
})

// --------------------------------------------------------------------- files

const fileRoute = (path: string, operationId: string, mediaType: string, summary: string) =>
  createRoute({ method: 'get', path, operationId, tags: ['files'], summary, responses: { 200: file(mediaType, summary), ...problems } })

export const csvRoute = fileRoute('/dane/aed.csv', 'downloadCsv', 'text/csv', 'National dataset as CSV (RFC 4180, UTF-8) – the resource dane.gov.pl harvests')
export const geojsonRoute = fileRoute('/dane/aed.geojson', 'downloadGeoJson', 'application/geo+json', 'National dataset as GeoJSON')
export const jsonldRoute = fileRoute('/dane/aed.jsonld', 'downloadJsonLd', 'application/ld+json', 'National dataset as JSON-LD (schema.org)')
export const csvwRoute = fileRoute('/dane/aed.csv-metadata.json', 'downloadCsvw', 'application/csvm+json', 'CSVW metadata of the CSV file')
export const tableSchemaRoute = fileRoute('/dane/schema.json', 'downloadTableSchema', 'application/json', 'The data pattern as a Frictionless Table Schema')
export const patternDocRoute = fileRoute('/dane/wzorzec.md', 'downloadPatternDoc', 'text/markdown', 'The data pattern as a readable field table')
export const patternXlsxRoute = fileRoute(
  '/dane/wzorzec.xlsx',
  'downloadPatternXlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'The data pattern as an Excel workbook: field table, dictionaries, example row and an empty template',
)
export const templateRoute = fileRoute('/dane/szablon.csv', 'downloadTemplate', 'text/csv', 'Empty CSV template with the header and one example row')
export const sourceScopeRoute = fileRoute('/dane/zakres-zrodel.csv', 'downloadSourceScope', 'text/csv', 'Data scope of every source against the pattern: one row per source and field')
export const communityRoute = fileRoute('/dane/aed-osm.geojson', 'downloadCommunity', 'application/geo+json', 'Unconfirmed devices known only from OpenStreetMap (ODbL) – not part of the dataset for dane.gov.pl')
export const feedRoute = fileRoute('/feeds/dane-gov-pl.xml', 'getHarvesterFeed', 'application/xml', 'Feed for the dane.gov.pl harvester (XML, schema 1.13)')

// -------------------------------------------------------------------- wizard

const MappingTargetSchema = z.string().openapi({ description: 'Pole wzorca albo jedna z kolumn złożonych: adres, ulica, wspolrzedne', example: 'szerokosc_geograficzna' })

export const ImportRequest = z
  .object({
    fileName: z.string().max(200).openapi({ example: 'aed-marki.csv' }),
    contentBase64: z.string().openapi({ description: 'The file, base64-encoded (CSV, XLSX or GeoJSON, up to 5 MB)' }),
    mapping: z
      .record(z.string(), MappingTargetSchema.nullable())
      .optional()
      .openapi({ description: 'Column header → target. Omit to let the system propose one; send the corrected proposal back to preview again.' }),
    provider: z
      .object({
        name: z.string().min(2).max(200).openapi({ example: 'Urząd Miasta Marki' }),
        email: z.string().email().optional(),
        licence: z.enum(['CC0 1.0', 'CC BY 4.0']).default('CC0 1.0'),
      })
      .optional(),
    invitation: z
      .string()
      .max(500)
      .optional()
      .openapi({ description: 'Token z linku zaproszenia wysłanego przez operatora (Radar). Zgłoszenie z ważnym zaproszeniem jest publikowane bez osobnego zatwierdzania.' }),
  })
  .openapi('ImportRequest')

export const ImportPreview = z
  .object({
    stub: z.boolean().openapi({ description: 'true while this endpoint answers with sample data' }),
    format: z.enum(['csv', 'geojson', 'xlsx', 'xls']),
    fileFixes: z.array(FixSchema),
    columns: z.array(
      z.object({
        header: z.string(),
        target: MappingTargetSchema.nullable(),
        confidence: z.number().min(0).max(1),
        reason: z.string().openapi({ description: 'Why the system proposes this target', example: 'wartości w zakresie szerokości geograficznej Polski' }),
        samples: z.array(z.string()),
      }),
    ),
    rows: z.array(
      z.object({
        index: z.number().int(),
        record: z.record(z.string(), z.unknown()).openapi({ description: 'Pola wzorca, które udało się ustalić' }),
        fixes: z.array(FixSchema),
        issues: z.array(IssueSchema),
        duplicateOf: z
          .object({ id: z.string(), nazwa: z.string(), distanceM: z.number().int(), decision: z.enum(['auto', 'review']), publication: Publication })
          .nullable()
          .openapi({
            description:
              'Urządzenie już znane systemowi, które wygląda na to samo. Przy publication = community zgłoszenie potwierdza urządzenie znane dotąd tylko z OpenStreetMap.',
          }),
      }),
    ),
    summary: z.object({ rows: z.number().int(), ready: z.number().int(), withFixes: z.number().int(), withErrors: z.number().int(), duplicates: z.number().int() }),
  })
  .openapi('ImportPreview')

export const importPreviewRoute = createRoute({
  method: 'post',
  path: '/v1/import/preview',
  operationId: 'previewImport',
  tags: ['wizard'],
  summary: 'Reads a provider file, proposes the column mapping and shows every fix and problem before anything is saved',
  request: { body: { required: true, content: { 'application/json': { schema: ImportRequest } } } },
  responses: { 200: json(ImportPreview, 'What the file would become'), 400: problem('The file could not be read'), ...problems },
})

export const ImportResult = z
  .object({
    stub: z.boolean(),
    status: z.enum(['published', 'pending']).openapi({ description: 'published = w zbiorze krajowym; pending = czeka na zatwierdzenie przez operatora' }),
    sourceId: z.string(),
    added: z.number().int(),
    merged: z.number().int().openapi({ description: 'Rows merged into devices already in the national dataset' }),
    incomplete: z.number().int(),
    files: z.object({ csv: z.string(), report: z.string() }).openapi({ description: 'Links for the provider: their data in the pattern, and the quality report' }),
    devices: z
      .array(z.object({ id: z.string(), name: z.string(), ownerUrl: z.string(), passportUrl: z.string(), stickerUrl: z.string() }))
      .openapi({ description: 'Published devices of the submission with the keeper links: passport management and the sticker to print. Empty while pending.' }),
  })
  .openapi('ImportResult')

export const importCommitRoute = createRoute({
  method: 'post',
  path: '/v1/import/commit',
  operationId: 'commitImport',
  tags: ['wizard'],
  summary: 'Saves a previewed file as a source and merges it into the national dataset',
  request: { body: { required: true, content: { 'application/json': { schema: ImportRequest } } } },
  responses: { 200: json(ImportResult, 'Saved and merged'), 400: problem('The file could not be read'), ...problems },
})

export const sourceCsvRoute = createRoute({
  method: 'get',
  path: '/v1/sources/{id}/aed.csv',
  operationId: 'downloadSourceCsv',
  tags: ['wizard'],
  summary: "One provider's devices in the data pattern: the file they can publish in their own dane.gov.pl dataset",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: file('text/csv', 'CSV in the data pattern'), 404: problem('No source with this id'), ...problems },
})

export const approveSourceRoute = createRoute({
  method: 'post',
  path: '/admin/sources/{id}/approve',
  operationId: 'approveSource',
  tags: ['admin'],
  summary: 'Approves a wizard submission, so that its devices enter the national dataset',
  security: operatorOnly.security,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: json(ImportResult, 'Approved and merged'), 404: problem('No submission with this id'), ...operatorOnly.responses401, ...problems },
})

// --------------------------------------------------------------------- radar

export const Candidate = z
  .object({
    id: z.string(),
    kind: z.enum(['osm_gap', 'procurement', 'web']).openapi({ description: 'osm_gap = jest w OSM, brak w danych urzędowych; procurement = ogłoszenie o zakupie; web = strona gminy lub BIP' }),
    status: z.enum(['new', 'invited', 'confirmed', 'rejected']),
    title: z.string().openapi({ example: 'Gmina Miasto Kołobrzeg kupiła defibrylatory AED do miejsc publicznych' }),
    organisation: z.string().nullable(),
    nip: z.string().nullable(),
    kodTerc: z.string().nullable(),
    locality: z.string().nullable(),
    devices: z.number().int().nullable().openapi({ description: 'How many devices the lead is about, when known' }),
    registered: z.number().int().nullable().openapi({ description: 'Official records already in that commune' }),
    evidence: z.object({ url: z.string(), quote: z.string(), date: z.string().nullable() }),
    confidence: z.number().min(0).max(1),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
  })
  .openapi('Candidate', { description: 'Wskazówka Radaru: urządzenie albo podmiot, którego brakuje w zbiorze urzędowym.' })

export const candidatesRoute = createRoute({
  method: 'get',
  path: '/v1/candidates',
  operationId: 'listCandidates',
  tags: ['radar'],
  summary: 'Leads to devices missing from the official dataset',
  request: { query: z.object({ status: z.enum(['new', 'invited', 'confirmed', 'rejected']).optional(), kind: z.enum(['osm_gap', 'procurement', 'web']).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }) },
  responses: { 200: json(z.object({ stub: z.boolean(), total: z.number().int(), items: z.array(Candidate) }).openapi('CandidateList'), 'Leads'), ...problems },
})

export const candidateDecisionRoute = createRoute({
  method: 'post',
  path: '/v1/candidates/{id}/decision',
  operationId: 'decideCandidate',
  tags: ['radar'],
  summary: 'Operator decision on a lead: reject it, or invite the owner to confirm',
  security: operatorOnly.security,
  request: {
    params: z.object({ id: z.string() }),
    body: { required: true, content: { 'application/json': { schema: z.object({ decision: z.enum(['reject', 'invite']) }).openapi('CandidateDecision') } } },
  },
  responses: {
    200: json(z.object({ stub: z.boolean(), candidate: Candidate, confirmationUrl: z.string().nullable() }).openapi('CandidateDecisionResult'), 'Updated lead'),
    404: problem('No lead with this id'),
    ...operatorOnly.responses401,
    ...problems,
  },
})

// ------------------------------------------------------------------ passport

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2027-06-30' })

export const ReportKind = z.enum(['ok', 'locked', 'missing', 'battery_alarm', 'damaged']).openapi('ReportKind', {
  description: 'ok = urządzenie jest na miejscu, zielona dioda miga; locked = szafka zamknięta; missing = brak urządzenia; battery_alarm = sygnał baterii; damaged = uszkodzone',
})

export const PassportPublic = z
  .object({
    id: z.string(),
    name: z.string(),
    publication: Publication,
    status: z.enum(STATUS),
    confirmedAt: z.string().nullable().openapi({ description: 'Ostatnie potwierdzenie sprawności (data weryfikacji)' }),
    confirmedByKeeper: z.boolean().openapi({ description: 'true, gdy datę potwierdził opiekun w paszporcie, a nie tylko podało ją źródło' }),
    items: z.array(
      z.object({
        item: z.enum(['electrodes', 'electrodes_child', 'battery']),
        label: z.string(),
        date: z.string().nullable(),
        state: z.enum(['ok', 'soon', 'expired', 'unknown']).openapi({ description: 'soon = 30 dni albo mniej do terminu' }),
        daysLeft: z.number().int().nullable(),
      }),
    ),
    reports: z.object({
      lastOk: z.string().nullable().openapi({ description: 'Ostatnie „jest na miejscu” od przechodnia (30 dni)' }),
      okCount: z.number().int(),
      problems: z.array(z.object({ kind: ReportKind, count: z.number().int(), lastAt: z.string() })).openapi({ description: 'Problemy zgłoszone po ostatnim potwierdzeniu' }),
    }),
    keeperEmail: z.string().nullable().openapi({ description: 'Zamaskowany adres opiekuna, na który można wysłać link do zarządzania' }),
    passportUrl: z.string(),
  })
  .openapi('PassportPublic', { description: 'Cyfrowy Paszport AED: stan urządzenia widoczny dla każdego, kto zeskanuje naklejkę.' })

const AedIdParam = z.object({ id: z.string() })

export const passportRoute = createRoute({
  method: 'get',
  path: '/v1/aed/{id}/passport',
  operationId: 'getPassport',
  tags: ['passport'],
  summary: 'Public passport of a device: confirmations, expiry dates and reports of passers-by',
  request: { params: AedIdParam },
  responses: { 200: json(PassportPublic, 'Passport'), 404: problem('No device with this id'), ...problems },
})

export const ReportRequest = z.object({ kind: ReportKind, note: z.string().max(300).optional() }).openapi('ReportRequest')

export const reportRoute = createRoute({
  method: 'post',
  path: '/v1/aed/{id}/reports',
  operationId: 'reportAed',
  tags: ['passport'],
  summary: 'A passer-by who scanned the sticker says the device is there, or reports a problem',
  request: { params: AedIdParam, body: { required: true, content: { 'application/json': { schema: ReportRequest } } } },
  responses: {
    200: json(
      z.object({ outcome: z.enum(['accepted', 'duplicate', 'limit']).openapi({ description: 'duplicate = ta sama osoba zgłosiła już coś przy tym urządzeniu w ciągu godziny' }), passport: PassportPublic }).openapi('ReportResult'),
      'Report taken',
    ),
    404: problem('No device with this id'),
    ...problems,
  },
})

export const ownerLinkRequestRoute = createRoute({
  method: 'post',
  path: '/v1/aed/{id}/passport/link',
  operationId: 'requestOwnerLink',
  tags: ['passport'],
  summary: 'Sends the management link to the keeper email already in the data (never to an address given in the request)',
  request: { params: AedIdParam },
  responses: {
    200: json(z.object({ sentTo: z.string() }).openapi('OwnerLinkSent'), 'Sent'),
    404: problem('No device with this id'),
    409: problem('The device has no keeper email, or a link was sent minutes ago'),
    ...problems,
  },
})

export const OwnerPassport = z
  .object({
    electrodesExp: IsoDate.nullable(),
    electrodesChildExp: IsoDate.nullable(),
    batteryExp: IsoDate.nullable(),
    status: z.enum(STATUS).nullable(),
    confirmedAt: z.string().nullable(),
    notifyEmail: z.string().nullable().openapi({ description: 'Prywatny adres do przypomnień; nie trafia do zbioru' }),
    notifyPhone: z.string().nullable().openapi({ description: 'Numer do przypomnień SMS (+48…); nie trafia do zbioru' }),
  })
  .openapi('OwnerPassport')

export const OwnerPassportUpdate = z
  .object({
    electrodesExp: IsoDate.nullable().optional(),
    electrodesChildExp: IsoDate.nullable().optional(),
    batteryExp: IsoDate.nullable().optional(),
    status: z.enum(STATUS).nullable().optional(),
    notifyEmail: z.string().max(120).nullable().optional(),
    notifyPhone: z.string().max(24).nullable().optional(),
  })
  .openapi('OwnerPassportUpdate')

export const OwnerView = z
  .object({
    aed: AedItem,
    passport: OwnerPassport,
    public: PassportPublic,
    reports: z.array(z.object({ kind: ReportKind, note: z.string().nullable(), at: z.string() })),
    messages: z.array(z.object({ channel: z.enum(['email', 'sms']), recipient: z.string(), subject: z.string(), reason: z.string(), at: z.string(), status: z.enum(['sent', 'logged', 'failed']) })),
    stickerUrl: z.string(),
  })
  .openapi('OwnerView')

const ownerHeaders = z.object({ 'x-owner-token': z.string().min(10).openapi({ description: 'Token z linku dla opiekuna (parametr t)' }) })
const ownerResponses = { 200: json(OwnerView, 'The device as its keeper sees it'), 401: problem('Missing, wrong or revoked owner link'), ...problems }

export const ownerPassportRoute = createRoute({
  method: 'get',
  path: '/v1/owner/passport',
  operationId: 'getOwnerPassport',
  tags: ['passport'],
  summary: 'The passport of the device the owner link is for',
  request: { headers: ownerHeaders },
  responses: ownerResponses,
})

export const ownerUpdateRoute = createRoute({
  method: 'post',
  path: '/v1/owner/passport',
  operationId: 'updateOwnerPassport',
  tags: ['passport'],
  summary: 'The keeper changes expiry dates, status or the private contact for reminders',
  request: { headers: ownerHeaders, body: { required: true, content: { 'application/json': { schema: OwnerPassportUpdate } } } },
  responses: ownerResponses,
})

export const ownerConfirmRoute = createRoute({
  method: 'post',
  path: '/v1/owner/passport/confirm',
  operationId: 'confirmOwnerPassport',
  tags: ['passport'],
  summary: '„Potwierdzam sprawność”: status czynny and today as the verification date, in the published dataset at once',
  request: { headers: ownerHeaders },
  responses: ownerResponses,
})

export const OwnerLinks = z.object({ ownerUrl: z.string(), passportUrl: z.string(), stickerUrl: z.string() }).openapi('OwnerLinks')

export const adminOwnerLinkRoute = createRoute({
  method: 'post',
  path: '/admin/aed/{id}/owner-link',
  operationId: 'createOwnerLink',
  tags: ['admin'],
  summary: 'A management link for the keeper of a device; rotate = true revokes the links given out before',
  security: operatorOnly.security,
  request: {
    params: AedIdParam,
    body: { required: false, content: { 'application/json': { schema: z.object({ rotate: z.boolean().default(false) }).openapi('OwnerLinkOptions') } } },
  },
  responses: { 200: json(OwnerLinks, 'Links'), 404: problem('No device with this id'), ...operatorOnly.responses401, ...problems },
})

export const outboxRoute = createRoute({
  method: 'get',
  path: '/admin/outbox',
  operationId: 'listOutbox',
  tags: ['admin'],
  summary: 'Messages sent to keepers (or only logged, when no mail or SMS account is configured)',
  security: operatorOnly.security,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }) },
  responses: {
    200: json(
      z
        .object({
          items: z.array(
            z.object({ id: z.string(), aedId: z.string().nullable(), channel: z.enum(['email', 'sms']), recipient: z.string(), subject: z.string(), body: z.string(), reason: z.string(), at: z.string(), status: z.enum(['sent', 'logged', 'failed']), error: z.string().nullable() }),
          ),
        })
        .openapi('Outbox'),
      'Newest first',
    ),
    ...operatorOnly.responses401,
    ...problems,
  },
})

// ---------------------------------------------------------------------- gaps

export const GapsTotals = z
  .object({
    residents: z.number().int(),
    seniors: z.number().int().openapi({ description: 'Residents aged 65 or more' }),
    noDevice: z.number().int().openapi({ description: 'Residents with no known device within reach at all' }),
    noNight: z.number().int().openapi({ description: 'Residents with no device they can reach on Sunday at 3:00' }),
    coveredShare: z.number().openapi({ description: 'Share of resident-hours of the week with a device in reach (0–1)' }),
  })
  .openapi('GapsTotals')

export const GapsMethod = z
  .object({
    resolution: z.number().int().openapi({ description: 'H3 resolution of the analysis' }),
    reachM: z.number().int().openapi({ description: 'A device counts for a hexagon when it is at most this far from its centre' }),
    seniorWeight: z.number().openapi({ description: 'How many times a resident aged 65+ counts in the ranking' }),
    nightHour: z.string().openapi({ example: 'niedziela 3:00' }),
    assumedHours: z.string().openapi({ description: 'Hours assumed for a device indoors that gives none', example: 'Mo-Fr 08:00-16:00' }),
    devices: z
      .object({
        total: z.number().int(),
        hours: z.number().int().openapi({ description: 'Hours read from the record' }),
        outdoor: z.number().int().openapi({ description: 'No hours, outside a building: counted as available around the clock' }),
        assumed: z.number().int().openapi({ description: 'No hours, inside a building or unknown: office hours assumed' }),
        excluded: z.number().int().openapi({ description: 'Private, withdrawn or out of service: not counted' }),
      })
      .openapi('GapsDeviceCounts'),
    sources: z.array(z.object({ name: z.string(), url: z.string(), licence: z.string(), attribution: z.string() })),
    datasetRanAt: z.string().nullable(),
  })
  .openapi('GapsMethod')

export const GapsSummary = z
  .object({
    ready: z.boolean().openapi({ description: 'false while the national figures are being computed (a few seconds after a start or a new merge)' }),
    computedAt: z.string().nullable(),
    tookMs: z.number().int().nullable(),
    totals: GapsTotals,
    method: GapsMethod,
  })
  .openapi('GapsSummary')

const Polygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.array(z.number()))).openapi({ description: 'Rings of [lon, lat] pairs' }) })

export const GapsOverview = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(
      z.object({
        type: z.literal('Feature'),
        geometry: Polygon,
        properties: z.object({ hex: z.string(), residents: z.number().int(), noDevice: z.number().int(), noNight: z.number().int(), coveredShare: z.number() }),
      }),
    ),
  })
  .openapi('GapsOverview')

export const GapsQuery = z.object({
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .openapi({ description: 'minLon,minLat,maxLon,maxLat – the area to analyse', example: '20.85,52.10,21.27,52.37' }),
  n: z.coerce.number().int().min(1).max(20).default(10).openapi({ description: 'How many places to recommend' }),
})

export const GapsNearbyDevice = z
  .object({
    id: z.string(),
    name: z.string(),
    distanceM: z.number().int(),
    hours: z.string().nullable(),
    basis: z.enum(['hours', 'outdoor', 'assumed', 'excluded']).openapi({ description: 'Where the hours come from: the record, outdoors (around the clock), assumed office hours, or not counted' }),
    hoursPerWeek: z.number().int(),
    atNight: z.boolean(),
    publication: z.enum(['official', 'community']),
  })
  .openapi('GapsNearbyDevice')

export const GapsPlace = z
  .object({
    rank: z.number().int(),
    hex: z.string(),
    lat: z.number(),
    lon: z.number(),
    gain: z.number().int().openapi({ description: 'Weighted resident-hours without a device that this place removes' }),
    gained: z
      .object({ residents: z.number().int(), seniors: z.number().int(), noDevice: z.number().int(), noNight: z.number().int() })
      .openapi({ description: 'Residents in reach who gain round-the-clock access by this place (not counted again by later places)' }),
    inReach: z.object({ residents: z.number().int(), seniors: z.number().int() }),
    coveredHoursNow: z.number().int(),
    nearby: z.array(GapsNearbyDevice),
    nearestAllWeek: z.object({ id: z.string(), name: z.string(), distanceM: z.number().int() }).nullable(),
    commune: z.object({ terc: z.string(), gmina: z.string(), powiat: z.string(), wojewodztwo: z.string() }).nullable(),
    address: z.string().nullable().openapi({ description: 'Nearest address point within 100 m, if there is one' }),
    boundary: Polygon,
  })
  .openapi('GapsPlace')

export const GapsView = z
  .object({
    tooLarge: z.boolean().openapi({ description: 'The area holds more populated squares than one analysis may; zoom in' }),
    cells: z.number().int(),
    maxCells: z.number().int(),
    totals: GapsTotals,
    hexes: z
      .object({
        type: z.literal('FeatureCollection'),
        features: z.array(
          z.object({
            type: z.literal('Feature'),
            geometry: Polygon,
            properties: z.object({
              hex: z.string(),
              residents: z.number(),
              coveredHours: z.number().int(),
              noDevice: z.boolean(),
              noNight: z.boolean(),
              uncovered: z.number().openapi({ description: 'Residents × share of the week without a device in reach' }),
            }),
          }),
        ),
      })
      .openapi('GapsHexes'),
    places: z.array(GapsPlace),
    method: GapsMethod,
  })
  .openapi('GapsView')

export const gapsSummaryRoute = createRoute({
  method: 'get',
  path: '/v1/gaps/summary',
  operationId: 'getGapsSummary',
  tags: ['gaps'],
  summary: 'National figures: residents with no defibrillator in reach, at all and at night, and how they were counted',
  responses: { 200: json(GapsSummary, 'National figures'), ...problems },
})

export const gapsOverviewRoute = createRoute({
  method: 'get',
  path: '/v1/gaps/overview.geojson',
  operationId: 'getGapsOverview',
  tags: ['gaps'],
  summary: 'The country in large hexagons (H3 resolution 6) with residents and gaps, for the map',
  responses: { 200: json(GapsOverview, 'Large hexagons; empty while the national figures are being computed'), ...problems },
})

export const gapsRoute = createRoute({
  method: 'get',
  path: '/v1/gaps',
  operationId: 'getGaps',
  tags: ['gaps'],
  summary: 'Gaps in one area: hexagons with the hours a defibrillator is in reach, and the best places for new ones',
  request: { query: GapsQuery },
  responses: { 200: json(GapsView, 'The analysis of the area'), ...problems },
})

export const gapsCsvRoute = createRoute({
  method: 'get',
  path: '/v1/gaps.csv',
  operationId: 'downloadGapsCsv',
  tags: ['gaps'],
  summary: 'The recommended places of an area as CSV (ODbL 1.0: device positions come partly from OpenStreetMap)',
  request: { query: GapsQuery },
  responses: { 200: file('text/csv', 'One row per recommended place'), ...problems },
})

// --------------------------------------------------------------------- admin

export const JobResult = z
  .object({
    job: z.string(),
    tookMs: z.number().int(),
    summary: z.record(z.string(), z.unknown()),
  })
  .openapi('JobResult')

export const jobRoute = createRoute({
  method: 'post',
  path: '/admin/jobs/{name}',
  operationId: 'runJob',
  tags: ['admin'],
  summary: 'Runs a pipeline job inside the API process (the only process that may open the database)',
  security: operatorOnly.security,
  request: {
    params: z.object({ name: z.enum(['pipeline', 'enrich-osm', 'radar', 'reminders']) }),
    body: {
      required: false,
      content: { 'application/json': { schema: z.object({ refresh: z.boolean().default(false).openapi({ description: 'Download fresh copies of the sources first' }) }).openapi('JobOptions') } },
    },
  },
  responses: { 200: json(JobResult, 'Job finished'), ...operatorOnly.responses401, ...problems },
})
