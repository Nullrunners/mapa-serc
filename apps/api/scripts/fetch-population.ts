/**
 * Builds `reference/census-2021-pl.csv.gz`: residents of Poland in the 1 km grid of the 2021 census, the demand side
 * of the gap analysis (`src/gaps`). Run once; the result is committed, so neither the API nor the deployment needs
 * the network for it.
 *
 *   pnpm --filter @aed/api exec tsx scripts/fetch-population.ts
 *
 * Source: Eurostat, Census 2021 grid V3 (data delivered by GUS for Poland), © European Union, CC BY 4.0.
 * The archive is 566 MB and the server is slow (tens of KB/s per connection), so only the one CSV member is read,
 * with HTTP range requests in parallel parts that resume where they stopped. Parts land in data/raw/eurostat/.
 */
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createInflateRaw, crc32, gzipSync } from 'node:zlib'

const URL_ZIP = 'https://gisco-services.ec.europa.eu/census/2021/Eurostat_Census-GRID_2021_V3.zip'
const MEMBER = 'Eurostat_Census-GRID_2021_V3/ESTAT_Census_2021_V3.csv'
const PARTS = 12

const API_ROOT = resolve(import.meta.dirname, '..')
const WORK = resolve(API_ROOT, '../../data/raw/eurostat')
const OUT = join(API_ROOT, 'reference/census-2021-pl.csv.gz')

async function range(from: number, to: number): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(URL_ZIP, { headers: { Range: `bytes=${from}-${to}` }, signal: AbortSignal.timeout(120_000) })
      if (response.status !== 206) throw new Error(`HTTP ${response.status}, expected 206`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (attempt >= 5) throw error
      console.error(`range ${from}-${to}: ${error instanceof Error ? error.message : error}; retry ${attempt}`)
      await new Promise((done) => setTimeout(done, 2000 * attempt))
    }
  }
}

/** Finds the member in the central directory at the end of the archive. */
async function locate(): Promise<{ start: number; compressed: number; uncompressed: number; crc: number }> {
  const head = await fetch(URL_ZIP, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  const tail = await range(size - 131072, size - 1)
  let at = 0
  while ((at = tail.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at)) >= 0) {
    const nameLength = tail.readUInt16LE(at + 28)
    const extraLength = tail.readUInt16LE(at + 30)
    const commentLength = tail.readUInt16LE(at + 32)
    const name = tail.subarray(at + 46, at + 46 + nameLength).toString()
    if (name === MEMBER) {
      const crc = tail.readUInt32LE(at + 16)
      let compressed = tail.readUInt32LE(at + 20)
      let uncompressed = tail.readUInt32LE(at + 24)
      let offset = tail.readUInt32LE(at + 42)
      // ZIP64: sizes and offset that do not fit in 32 bits sit in the extra field 0x0001, in this order.
      let p = at + 46 + nameLength
      const end = p + extraLength
      while (p + 4 <= end) {
        const id = tail.readUInt16LE(p)
        const length = tail.readUInt16LE(p + 2)
        if (id === 1) {
          let q = p + 4
          if (uncompressed === 0xffffffff) (uncompressed = Number(tail.readBigUInt64LE(q))), (q += 8)
          if (compressed === 0xffffffff) (compressed = Number(tail.readBigUInt64LE(q))), (q += 8)
          if (offset === 0xffffffff) offset = Number(tail.readBigUInt64LE(q))
        }
        p += 4 + length
      }
      const local = await range(offset, offset + 29)
      const start = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      return { start, compressed, uncompressed, crc }
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`${MEMBER} not found in the archive`)
}

/** Downloads one part into its own file, continuing from what is already on disk. */
async function part(index: number, from: number, to: number): Promise<string> {
  const file = join(WORK, `part-${String(index).padStart(2, '0')}`)
  const want = to - from + 1
  let have = existsSync(file) ? statSync(file).size : 0
  const fd = openSync(file, 'a')
  try {
    while (have < want) {
      const step = Math.min(want - have, 2 * 1024 * 1024)
      const bytes = await range(from + have, from + have + step - 1)
      writeSync(fd, bytes)
      have += bytes.length
      console.log(`part ${index}: ${((have / want) * 100).toFixed(0)}%`)
    }
  } finally {
    closeSync(fd)
  }
  return file
}

mkdirSync(WORK, { recursive: true })
const member = await locate()
console.log(`member: ${(member.compressed / 1e6).toFixed(1)} MB compressed, ${(member.uncompressed / 1e6).toFixed(1)} MB, starts at ${member.start}`)

const size = Math.ceil(member.compressed / PARTS)
const files = await Promise.all(
  Array.from({ length: PARTS }, (_, index) => {
    const from = member.start + index * size
    const to = Math.min(member.start + member.compressed - 1, from + size - 1)
    return part(index, from, to)
  }),
)

// Inflate the parts in order as one stream and keep Polish cells with residents.
const inflate = createInflateRaw()
let checksum = 0
let inflated = 0
inflate.on('data', (chunk: Buffer) => {
  checksum = crc32(chunk, checksum)
  inflated += chunk.length
})
const feed = (async () => {
  for (const file of files) {
    for await (const chunk of createReadStream(file)) if (!inflate.write(chunk)) await new Promise((done) => inflate.once('drain', done))
  }
  inflate.end()
})()

const rows: string[] = ['n_km,e_km,t,y_ge65']
let header: string[] | null = null
let total = 0
for await (const line of createInterface({ input: inflate })) {
  const cells = line.split(',')
  if (!header) {
    header = cells
    continue
  }
  const get = (name: string) => cells[header!.indexOf(name)] ?? ''
  if (!get('CNTR_ID').split('-').includes('PL')) continue
  const t = Number(get('T'))
  if (!(t > 0)) continue
  const match = get('GRD_ID').match(/^CRS3035RES1000mN(\d+)E(\d+)$/)
  if (!match) continue
  const seniors = Number(get('Y_GE65'))
  rows.push(`${Number(match[1]) / 1000},${Number(match[2]) / 1000},${t},${seniors >= 0 ? Math.min(seniors, t) : 0}`)
  total += t
}
await feed

if (inflated !== member.uncompressed || checksum >>> 0 !== member.crc >>> 0) {
  throw new Error(`checksum mismatch: ${inflated} bytes, crc ${checksum.toString(16)} (expected ${member.uncompressed}, ${member.crc.toString(16)}). Delete ${WORK} and run again.`)
}
mkdirSync(join(API_ROOT, 'reference'), { recursive: true })
writeFileSync(OUT, gzipSync(rows.join('\n') + '\n', { level: 9 }))
console.log(`${rows.length - 1} cells, ${total} residents → ${OUT} (${(statSync(OUT).size / 1e6).toFixed(2)} MB)`)
