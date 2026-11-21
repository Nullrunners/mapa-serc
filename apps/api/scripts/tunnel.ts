/**
 * Public https addresses for the API and the web app running on this machine, through Cloudflare quick tunnels: no
 * account, and new addresses on every start. For showing the prototype to someone else, on a phone, or to the
 * dane.gov.pl harvester (the feed wants https links).
 *
 *   pnpm tunnel
 *
 * The site reaches the API through its own /api path (apps/web/next.config.ts), so it works through the tunnel
 * without restarting anything. The first run asks before downloading cloudflared from GitHub. PORT (the API) and
 * WEB_PORT (default 3000) come from the environment or the root .env. Ctrl+C closes the tunnels.
 */
import { startTunnel, type Tunnel } from 'untun'

// Both servers listen on IPv4; "localhost" may resolve to ::1 and leave a tunnel answering 502.
const api = `http://127.0.0.1:${process.env.PORT ?? 8787}`
const web = `http://127.0.0.1:${process.env.WEB_PORT ?? 3000}`

async function running(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return true
  } catch {
    return false
  }
}

// An address that only answers 502 is worse than a clear message now.
const [apiUp, webUp] = await Promise.all([running(`${api}/health`), running(`${web}/api/health`)])
if (!apiUp) {
  console.error(`No API at ${api}. Start it first (pnpm dev:api), or set PORT if it runs on another port.`)
  process.exit(1)
}
if (!webUp) console.warn(`No web app at ${web}, so only the API gets an address. Start it with pnpm dev:web and run this again.`)

const tunnels: Tunnel[] = []
async function open(url: string): Promise<string> {
  const tunnel = await startTunnel({ url })
  // Undefined: the person did not agree to download cloudflared.
  if (!tunnel) return process.exit(1)
  tunnels.push(tunnel)
  return tunnel.getURL()
}

let apiUrl: string
let webUrl: string | null
try {
  // One after the other: the first run downloads cloudflared, and two downloads at once would collide.
  apiUrl = await open(api)
  webUrl = webUp ? await open(web) : null
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await Promise.all(tunnels.map((tunnel) => tunnel.close()))
  process.exit(1)
}

console.log(`
${webUrl ? `Site: ${webUrl}\n` : ''}API:  ${apiUrl}  (reference: ${apiUrl}/docs)

The addresses are new on every start. Links in emails, on stickers and in the dane.gov.pl feed are built by the API;
to point them at the tunnels, restart it with:
  ${webUrl ? `PUBLIC_WEB_URL=${webUrl} ` : ''}PUBLIC_API_URL=${apiUrl} pnpm dev:api

Ctrl+C closes the tunnels.`)
