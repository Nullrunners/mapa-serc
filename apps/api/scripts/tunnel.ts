/**
 * A public https address for the API running on this machine, through a Cloudflare quick tunnel: no account, and a
 * new address on every start. For when something outside this machine must reach the API, e.g. the dane.gov.pl
 * harvester (the feed wants https links) or a web app deployed elsewhere.
 *
 *   pnpm tunnel
 *
 * The first run asks before downloading cloudflared from GitHub. PORT comes from the environment or the root .env.
 * Ctrl+C closes the tunnel.
 */
import { startTunnel } from 'untun'

const port = Number(process.env.PORT ?? 8787)
// The API listens on 0.0.0.0 only; "localhost" may resolve to ::1 and leave the tunnel answering 502.
const local = `http://127.0.0.1:${port}`

// An address that only answers 502 is worse than a clear message now.
try {
  await fetch(`${local}/health`, { signal: AbortSignal.timeout(5_000) })
} catch {
  console.error(`No API at ${local}. Start it first (pnpm dev:api), or set PORT if it runs on another port.`)
  process.exit(1)
}

const tunnel = await startTunnel({ url: local })
if (!tunnel) process.exit(1)

let url: string
try {
  url = await tunnel.getURL()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await tunnel.close()
  process.exit(1)
}

console.log(`
API: ${url}  (reference: ${url}/docs)

The address is new on every start.
  Links in the dane.gov.pl feed: restart the API with PUBLIC_API_URL=${url}
  A web app elsewhere: build it with NEXT_PUBLIC_API_URL=${url} and add its address to CORS_ORIGINS of the API

Ctrl+C closes the tunnel.`)
