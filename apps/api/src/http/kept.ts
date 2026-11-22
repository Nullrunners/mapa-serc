/**
 * Large answers that are the same for everyone until the data changes: a map layer is several megabytes of JSON.
 * Such a body is built, checked against the contract and compressed once, then sent as it stands. It carries an
 * ETag, so a browser that already has it asks only whether its copy is still good and gets "304 Not Modified".
 */
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import type { Context } from 'hono'
import type { z } from '@hono/zod-openapi'
import { checked, type ok } from './respond'

/**
 * zlib hands its work to another thread a piece at a time, and takes up the next piece only when the server has a
 * moment. In megabyte pieces a layer is a few such trips, not hundreds, which counts while the server is busy.
 */
const PIECES = { chunkSize: 1 << 20 }
const compress = promisify(gzip)
const decompress = promisify(gunzip)

export interface KeptBody<S extends z.ZodType = z.ZodType> {
  /** The JSON text, gzipped: what nearly every client takes, and several times smaller to hold. */
  gzipped: Uint8Array<ArrayBuffer>
  etag: string
  /** The contract the body was checked against; only the types use it. */
  schema: S
}

const bytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)

/** Checks the body against the contract, as `ok` does, and keeps it ready to send. */
export async function keepJson<S extends z.ZodType>(c: Context, schema: S, body: z.input<S>): Promise<KeptBody<S>> {
  const text = JSON.stringify(checked(c, schema, body))
  // From the content, not from a counter: the same data has the same tag after a restart, so browsers keep their copy.
  // Weak, because the same tag goes with the compressed and the plain form.
  const etag = `W/"${createHash('sha1').update(text).digest('base64url')}"`
  return { gzipped: bytes(await compress(text, PIECES)), etag, schema }
}

/**
 * One kept body per key, rebuilt when `version` changes. A build that failed is not kept: the next request tries again.
 * With `max`, only that many are kept, the ones asked for longest ago going first: for keys anyone can make up.
 */
export class KeptBodies<V, S extends z.ZodType = z.ZodType> {
  private readonly entries = new Map<string, { version: V; body: Promise<KeptBody<S>> }>()

  constructor(private readonly max = Infinity) {}

  get(key: string, version: V, build: () => Promise<KeptBody<S>>): Promise<KeptBody<S>> {
    let entry = this.entries.get(key)
    // Asked for again: to the end of the line, the last to go.
    if (entry) this.entries.delete(key)
    if (entry?.version !== version) {
      entry = { version, body: build() }
      const built = entry
      built.body.catch(() => {
        if (this.entries.get(key) === built) this.entries.delete(key)
      })
    }
    this.entries.set(key, entry)
    if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!)
    return entry.body
  }
}

/** Whether the tags the browser sent include ours ("*" matches anything). Weak comparison: W/ does not count. */
function sameTag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const bare = (tag: string) => tag.trim().replace(/^W\//, '')
  return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag))
}

/** Whether the client takes gzip: named (or covered by "*") and not switched off with q=0. */
function takesGzip(header: string | undefined): boolean {
  if (!header) return false
  return header.split(',').some((part) => {
    const [name, ...params] = part.split(';').map((token) => token.trim().toLowerCase())
    const q = params.find((param) => param.startsWith('q='))
    return (name === 'gzip' || name === '*') && (q === undefined || Number(q.slice(2)) > 0)
  })
}

/**
 * Sends a kept body, or "304 Not Modified" to a browser that already has it. By default the browser asks every time
 * whether its copy is still good (`no-cache`); give `cacheControl` where a copy a few minutes old does no harm.
 */
export async function sendKept<S extends z.ZodType>(c: Context, kept: KeptBody<S>, cacheControl = 'no-cache'): Promise<ReturnType<typeof ok<S>>> {
  return (await respond(c, kept, cacheControl)) as ReturnType<typeof ok<S>>
}

async function respond(c: Context, kept: KeptBody, cacheControl: string): Promise<Response> {
  c.header('ETag', kept.etag)
  c.header('Cache-Control', cacheControl)
  c.header('Vary', 'Accept-Encoding', { append: true })
  if (sameTag(c.req.header('If-None-Match'), kept.etag)) return c.body(null, 304)
  c.header('Content-Type', 'application/json')
  if (!takesGzip(c.req.header('Accept-Encoding'))) return c.body(bytes(await decompress(kept.gzipped, PIECES)))
  c.header('Content-Encoding', 'gzip')
  return c.body(kept.gzipped)
}
