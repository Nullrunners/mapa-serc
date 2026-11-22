/** HTTP application: middleware, error handling, the endpoint table, and the generated OpenAPI document. */
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { config } from './config'
import { endpoints } from './endpoints'
import { ApiError, problemResponse } from './http/errors'

/** A 5 MB file is about 7 MB as base64 inside JSON. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

const quiet = process.env.VITEST !== undefined || process.env.NODE_ENV === 'test'

export function createApp() {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) return
      return problemResponse(
        c,
        422,
        'validation_error',
        'The request does not match the API contract. See `issues` for the offending fields.',
        result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
      )
    },
  })

  // The data and the files are open: anyone may read them from any site. Only operator actions carry a token,
  // and a token in a header is not sent by a browser on its own, so an open origin list is safe for reads.
  app.use('/dane/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))
  app.use('/feeds/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))
  app.use('/v1/*', cors({ origin: (origin) => (config.corsOrigins.includes(origin) ? origin : null), allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'X-Owner-Token', 'X-Keeper-Session'], maxAge: 86_400 }))
  // The admin panel of the site calls these with the operator token; where the site and the API have different
  // addresses (the deployment), the browser asks first, and without an answer here it never sends the request.
  app.use('/admin/*', cors({ origin: (origin) => (config.corsOrigins.includes(origin) ? origin : null), allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'], maxAge: 86_400 }))
  app.use('/health', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))
  app.use('/openapi.json', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))

  app.use('*', async (c, next) => {
    const started = performance.now()
    await next()
    const elapsed = performance.now() - started
    c.header('Server-Timing', `app;dur=${elapsed.toFixed(1)}`)
    if (!quiet) console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${elapsed.toFixed(0)}ms`)
  })

  // The map layer is a few megabytes of JSON; compress it here as well, so a tunnel is as fast as the deployment.
  app.use('*', compress())

  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => problemResponse(c, 422, 'validation_error', 'The request is larger than 8 MB. Files up to 5 MB are accepted.'),
    }),
  )

  app.openAPIRegistry.registerComponent('securitySchemes', 'operatorToken', { type: 'http', scheme: 'bearer', description: 'ADMIN_TOKEN of the deployment' })

  for (const endpoint of endpoints) app.openapi(endpoint.route, endpoint.handler)

  app.get('/openapi.json', (c) => c.json(buildOpenApiDocument(app)))
  app.get('/docs', Scalar({ url: '/openapi.json', pageTitle: 'Mapa serc API' }))
  app.get('/', (c) => c.redirect('/docs'))

  app.notFound((c) => problemResponse(c, 404, 'not_found', `No route for ${c.req.method} ${c.req.path}. The API reference is at /docs.`))

  app.onError((error, c) => {
    if (error instanceof ApiError) return problemResponse(c, error.status, error.code, error.message, error.issues)
    if (error instanceof HTTPException) {
      // Thrown by Hono itself, for example for a body that is not valid JSON.
      return error.status === 400
        ? problemResponse(c, 400, 'validation_error', error.message || 'Malformed request.')
        : problemResponse(c, 500, 'internal_error', 'Unexpected error.')
    }
    console.error(`[error] ${c.req.method} ${c.req.path}`, error)
    return problemResponse(c, 500, 'internal_error', 'Unexpected error. The team has the details in the server log.')
  })

  return app
}

/** The contract as an OpenAPI 3.1 document. Deterministic: openapi/openapi.json is a committed copy of this. */
export function buildOpenApiDocument(app: OpenAPIHono) {
  const document = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Mapa serc API',
      version: config.version,
      description: [
        'One nationwide open dataset of AED defibrillators for dane.gov.pl: merged from municipal datasets and owner submissions, published as CSV, GeoJSON and a harvester feed.',
        '',
        'A device record uses the column names of the data pattern (`/v1/schema`, `/dane/schema.json`).',
        'Every operation carries `x-status`: `live` answers with real data, `stub` with sample data in the final shape and says so with `stub: true`.',
        '',
        'Two apps use it. The web app: the map, the provider wizard, passports, Radar AED and the gaps map. The Mapa serc mobile app, for an emergency:',
        'the nearest devices (`GET /v1/aed?near=lat,lon&layer=all&limit=10`, with `distanceM` and `availableNow`), the map layer kept on the phone',
        '(`GET /v1/aed.geojson`) and, after a sticker is scanned, the device, its passport and reports of passers-by (`/v1/aed/{id}`, `/v1/aed/{id}/passport`,',
        '`/v1/aed/{id}/reports`, `/v1/aed/{id}/passport/link`).',
        '',
        'Records with `publication = community` are known only from OpenStreetMap (ODbL) and are not confirmed by their owner; they are not part of the files under `/dane/aed.*`.',
      ].join('\n'),
      license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: [
      { name: 'meta', description: 'Liveness and implementation status' },
      { name: 'data', description: 'The national dataset: devices, map layer, statistics, sources, data pattern' },
      { name: 'files', description: 'The dataset as files and the feed for the dane.gov.pl harvester' },
      { name: 'wizard', description: 'Provider wizard (preview a file, then save it) and the form for reporting one device' },
      { name: 'geo', description: 'Lookups in the state address register for the map of the single-device form' },
      { name: 'radar', description: 'Radar AED: leads to devices missing from the official dataset' },
      { name: 'passport', description: 'Cyfrowy Paszport AED: the page behind the sticker, reports of passers-by, the keeper panel' },
      { name: 'account', description: 'Keeper account: logging in "with mObywatel" (a stand-in in this prototype) and the devices of the account' },
      { name: 'admin', description: 'Operator actions (token required)' },
    ],
  })

  for (const endpoint of endpoints) {
    const pathItem = document.paths?.[endpoint.route.path] as Record<string, Record<string, unknown> | undefined> | undefined
    const operation = pathItem?.[endpoint.route.method]
    if (operation) operation['x-status'] = endpoint.status
  }
  return document
}
