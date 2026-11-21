/**
 * Runs a pipeline job in the running API (the only process that may open the database).
 *
 *   pnpm job pipeline             # merge again from the copies on disk
 *   pnpm job pipeline --refresh   # download every source first
 *   pnpm job enrich-osm           # commune codes for the OpenStreetMap layer (minutes the first time)
 *   pnpm job radar                # rebuild the Radar leads
 *
 * API_URL (default http://localhost:PORT) and ADMIN_TOKEN come from the environment or the root .env.
 */
export {}

const [name, ...flags] = process.argv.slice(2)
if (!name) {
  console.error('usage: pnpm job <pipeline|enrich-osm|radar> [--refresh]')
  process.exit(2)
}

const base = (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, '')
const started = Date.now()

let response: Response
try {
  response = await fetch(`${base}/admin/jobs/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN ?? ''}` },
    body: JSON.stringify({ refresh: flags.includes('--refresh') }),
    signal: AbortSignal.timeout(30 * 60_000),
  })
} catch (error) {
  console.error(`Could not reach the API at ${base}. Start it first: pnpm dev:api\n${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

const body = (await response.json()) as { summary?: unknown; detail?: string }
if (!response.ok) {
  console.error(`HTTP ${response.status}: ${body.detail ?? JSON.stringify(body)}`)
  process.exit(1)
}
console.log(JSON.stringify(body.summary, null, 2))
console.log(`${name} finished in ${((Date.now() - started) / 1000).toFixed(1)} s`)
