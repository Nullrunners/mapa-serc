/** Large answers kept ready to send: the map layer is built once per state of the dataset and revalidated with an ETag. */
import { gunzipSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { getContext } from '../src/context'

const app = createApp()
const OPERATOR = { Authorization: 'Bearer test-token' }
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })

const LAYER = '/v1/aed.geojson?layer=official'

beforeAll(async () => {
  expect((await post('/admin/jobs/pipeline', {}, OPERATOR)).status).toBe(200)
})

describe('map layer', () => {
  it('holds every device of the layer, with the few properties the map needs', async () => {
    const { store } = await getContext()
    const response = await get(LAYER)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as any
    const official = store.aeds.filter((aed) => aed.publication === 'official')
    expect(body.type).toBe('FeatureCollection')
    expect(body.features).toHaveLength(official.length)
    const first = official[0]!
    expect(body.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [first.record.dlugosc_geograficzna, first.record.szerokosc_geograficzna] },
      properties: { id: first.id, nazwa: first.record.nazwa, publication: 'official', dostep: first.record.dostep, godziny_dostepnosci: first.record.godziny_dostepnosci, status: first.record.status, quality: first.quality },
    })
  })

  it('answers "not modified" to a browser that already has the layer', async () => {
    const first = await get(LAYER)
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/^W\/".+"$/)
    expect(first.headers.get('cache-control')).toBe('no-cache')

    const again = await get(LAYER, { 'If-None-Match': etag })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    expect(again.headers.get('etag')).toBe(etag)
    // Browsers send the tags they hold as a list, and proxies may strip the weak mark.
    expect((await get(LAYER, { 'If-None-Match': `"other", ${etag.slice(2)}` })).status).toBe(304)
    expect((await get(LAYER, { 'If-None-Match': '"other"' })).status).toBe(200)
  })

  it('sends the same layer compressed to a client that takes gzip, and plain to one that does not', async () => {
    const plain = await (await get(LAYER)).text()
    const packed = await get(LAYER, { 'Accept-Encoding': 'br, gzip' })
    expect(packed.headers.get('content-encoding')).toBe('gzip')
    expect(packed.headers.get('vary')).toContain('Accept-Encoding')
    expect(gunzipSync(Buffer.from(await packed.arrayBuffer())).toString('utf8')).toBe(plain)

    const refused = await get(LAYER, { 'Accept-Encoding': 'gzip;q=0, identity' })
    expect(refused.headers.get('content-encoding')).toBeNull()
    expect(await refused.text()).toBe(plain)
  })

  it('changes as soon as a keeper changes a device, and again after the next merge only if the data did', async () => {
    const { store } = await getContext()
    const id = store.aeds.find((aed) => aed.publication === 'official' && aed.record.status !== 'czasowo_niedostepny')!.id
    const before = await get(LAYER)
    const etag = before.headers.get('etag')!

    const links = (await (await post(`/admin/aed/${id}/owner-link`, {}, OPERATOR)).json()) as any
    const token = new URL(links.ownerUrl).searchParams.get('t')!
    expect((await post('/v1/owner/passport', { status: 'czasowo_niedostepny' }, { 'X-Owner-Token': token })).status).toBe(200)

    const after = await get(LAYER, { 'If-None-Match': etag })
    expect(after.status).toBe(200)
    const changed = after.headers.get('etag')!
    expect(changed).not.toBe(etag)
    const feature = ((await after.json()) as any).features.find((item: any) => item.properties.id === id)
    expect(feature.properties.status).toBe('czasowo_niedostepny')

    // A merge that leaves the devices as they were gives the same tag, so browsers keep their copy.
    expect((await post('/admin/jobs/pipeline', {}, OPERATOR)).status).toBe(200)
    expect((await get(LAYER, { 'If-None-Match': changed })).status).toBe(304)
  })
})
