/**
 * Runs a pipeline job in the running API (the only process that may open the database).
 *
 *   pnpm job pipeline             # merge again from the copies on disk
 *   pnpm job pipeline --refresh   # download every source first
 *   pnpm job enrich-osm           # commune codes and addresses for the OpenStreetMap layer (minutes the first time)
 *   pnpm job radar                # rebuild the Radar leads
 *
 * API_URL (default http://localhost:PORT) and ADMIN_TOKEN come from the environment or the root .env.
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const [name, ...flags] = process.argv.slice(2)
if (!name) {
  console.error('usage: pnpm job <pipeline|enrich-osm|radar> [--refresh]')
  process.exit(2)
}

const base = (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, '')
const started = Date.now()

/**
 * The API answers when the job is done. `fetch` gives up after five minutes without an answer while the job
 * runs on, and the first enrich-osm run takes longer than that; a plain request waits as long as it is told to.
 */
function post(url: string, payload: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const send = url.startsWith('https:') ? httpsRequest : httpRequest
    const request = send(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN ?? ''}` }, timeout: 30 * 60_000 }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => (text += chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text }))
    })
    request.on('timeout', () => request.destroy(new Error('No answer after 30 minutes.')))
    request.on('error', reject)
    request.end(JSON.stringify(payload))
  })
}

let response: { status: number; text: string }
try {
  response = await post(`${base}/admin/jobs/${name}`, { refresh: flags.includes('--refresh') })
} catch (error) {
  console.error(`Could not reach the API at ${base}. Start it first: pnpm dev:api\n${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

const body = JSON.parse(response.text) as { summary?: unknown; detail?: string }
if (response.status < 200 || response.status >= 300) {
  console.error(`HTTP ${response.status}: ${body.detail ?? JSON.stringify(body)}`)
  process.exit(1)
}
console.log(JSON.stringify(body.summary, null, 2))
console.log(`${name} finished in ${((Date.now() - started) / 1000).toFixed(1)} s`)
