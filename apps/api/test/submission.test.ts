/** The single-device form over HTTP, in-process: report a device, the operator's queue, approve or reject, take back, and the address lookups. */
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { getContext } from '../src/context'
import type { Commune, GeocodedAddress } from '../src/pipeline/geocode'
import { mergeCluster } from '../src/pipeline/merge'
import type { NormalizedRecord, SourceDef } from '../src/pipeline/types'
import { USER_SOURCE } from '../src/submission/record'

const app = createApp()
const OPERATOR = { Authorization: 'Bearer test-token' }

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })
const del = (path: string, headers: Record<string, string> = {}) => app.request(path, { method: 'DELETE', headers })
const json = async (response: Response | Promise<Response>) => (await (await response).json()) as any

// Every report comes from its own address unless a test is about the limit for one person.
let clients = 0
const someone = () => ({ 'X-Forwarded-For': `10.1.${Math.floor(++clients / 250)}.${clients % 250}` })

const BIALE_BLOTA: Commune = { terc: '0403022', gmina: 'Białe Błota', powiat: 'powiat bydgoski', wojewodztwo: 'kujawsko-pomorskie' }
const LEGIONOWO: Commune = { terc: '1408011', gmina: 'Legionowo (miasto)', powiat: 'powiat legionowski', wojewodztwo: 'mazowieckie' }
const SZUBINSKA_7: GeocodedAddress = { lat: 53.09511, lon: 17.91722, city: 'Białe Błota', street: 'Szubińska', number: '7', postcode: '86-005', simc: '0093340' }

/** Answers of the registers for a point, put in their cache (tests never go online). Points have at most 5 decimals, as the cache keys do. */
async function knownPoint(lat: number, lon: number, commune: Commune | null, address?: GeocodedAddress) {
  const { store } = await getContext()
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`
  await store.geoCache().set(`uldk:${key}`, commune)
  if (address) await store.geoCache().set(`uug-point:${key}`, address)
}

const APTEKA = { nazwa: 'Apteka Pod Lipami', szerokosc_geograficzna: 53.0951, dlugosc_geograficzna: 17.9172, opis_lokalizacji: 'Przy wejściu', dostep: 'publiczny', godziny_dostepnosci: 'pn-pt 8-16', wewnatrz_budynku: true }
const report = (record: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ record: { ...APTEKA, ...record }, consent: true, ...extra })
const submit = async (body: unknown, headers: Record<string, string> = someone()) => post('/v1/import/device', body, headers)
const queue = async () => (await json(get('/admin/device-submissions', OPERATOR))).items as any[]
const outbox = async () => (await json(get('/admin/outbox?limit=500', OPERATOR))).items as any[]
const shared = async () => (await json(get('/v1/sources'))).items.find((source: any) => source.id === USER_SOURCE.id)

beforeAll(async () => {
  expect((await post('/admin/jobs/pipeline', {}, OPERATOR)).status).toBe(200)
  await knownPoint(53.0951, 17.9172, BIALE_BLOTA, SZUBINSKA_7)
})

describe('a single device reported by anyone', () => {
  let first: string
  let firstDevice: string
  let cityDevice: string

  it('waits for the operator: not on the map, not among the sources', async () => {
    const response = await submit(report({}, { keeperEmail: 'opiekun@example.org' }))
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toEqual({ id: expect.any(String), status: 'pending' })
    first = body.id

    const map = await json(get('/v1/aed.geojson?layer=all'))
    expect(map.features.some((feature: any) => feature.properties.nazwa === APTEKA.nazwa)).toBe(false)
    expect(await shared()).toBeUndefined()
  })

  it('refuses a report without consent, without a name, or outside Poland', async () => {
    expect((await submit({ ...report(), consent: false })).status).toBe(422)
    const unnamed = await submit(report({ nazwa: 'brak' }))
    expect(unnamed.status).toBe(422)
    expect((await json(unnamed)).detail).toContain('Brak nazwy miejsca')

    const abroad = await submit(report({ szerokosc_geograficzna: 48.5 }))
    expect(abroad.status).toBe(422)
    expect((await json(abroad)).detail).toContain('nie leży w Polsce')
    // The Baltic lies inside the box around Poland; the commune register knows there is no commune there.
    await knownPoint(54.6, 14.5, null)
    expect((await submit(report({ szerokosc_geograficzna: 54.6, dlugosc_geograficzna: 14.5 }))).status).toBe(422)
  })

  it('shows the operator the report with the address from the registers and a masked email', async () => {
    expect((await get('/admin/device-submissions')).status).toBe(401)
    const list = await json(get('/admin/device-submissions', OPERATOR))
    expect(JSON.stringify(list)).not.toContain('opiekun@example.org')
    expect(list.items.find((item: any) => item.id === first)).toMatchObject({
      record: {
        nazwa: APTEKA.nazwa,
        nazwa_ulicy: 'Szubińska',
        nr_budynku: '7',
        kod_pocztowy: '86-005',
        miejscowosc: 'Białe Błota',
        kod_terc: '0403022',
        dostep: 'publiczny',
        godziny_dostepnosci: 'Mo-Fr 08:00-16:00',
        wewnatrz_budynku: true,
      },
      keeperEmail: 'o***@example.org',
      duplicateOf: null,
    })
  })

  it('publishes an approved report in the shared source of user reports, with its feed, and sends the keeper the sticker', async () => {
    expect((await post(`/admin/device-submissions/${first}/approve`, {})).status).toBe(401)
    const approved = await json(post(`/admin/device-submissions/${first}/approve`, {}, OPERATOR))
    expect(approved).toMatchObject({ id: first, device: { publication: 'official' }, keeper: 'sent' })
    firstDevice = approved.device.id

    const device = await json(get(`/v1/aed/${firstDevice}`))
    expect(device.record).toMatchObject({
      nazwa: APTEKA.nazwa,
      kod_terc: '0403022',
      miejscowosc: 'Białe Błota',
      nazwa_ulicy: 'Szubińska',
      godziny_dostepnosci: 'Mo-Fr 08:00-16:00',
      zrodlo: 'Zgłoszenia użytkowników Mapy serc',
      licencja: 'CC0 1.0',
    })
    expect(await shared()).toMatchObject({ kind: 'user', awaitingApproval: false, official: 1, feedUrl: expect.stringContaining(`/feeds/dostawcy/${USER_SOURCE.id}/`) })
    const feed = await get(`/feeds/dostawcy/${USER_SOURCE.id}/dane-gov-pl.xml`)
    expect(feed.status).toBe(200)
    expect(await feed.text()).toContain('wykaz-aed')

    const welcome = (await outbox()).find((message) => message.reason === 'passports_ready' && message.aedId === firstDevice)
    expect(welcome).toMatchObject({ recipient: 'opiekun@example.org', channel: 'email' })
    for (const path of ['/v1/sources', '/dane/aed.csv', `/v1/aed/${firstDevice}`, `/v1/aed/${firstDevice}/passport`]) {
      expect(await (await get(path)).text()).not.toContain('opiekun@example.org')
    }
    expect((await queue()).some((item) => item.id === first)).toBe(false)
    // The wizard's endpoints for whole submissions cannot touch the shared source.
    expect((await del(`/admin/sources/${USER_SOURCE.id}`, OPERATOR)).status).toBe(404)
  })

  it('adds a second report to the same source, and the same keeper gets the links of that device too', async () => {
    await knownPoint(53.1, 17.95, BIALE_BLOTA, { ...SZUBINSKA_7, lat: 53.10001, lon: 17.95002, street: 'Leśna', number: '3' })
    const second = await json(submit(report({ nazwa: 'Siłownia Forma', szerokosc_geograficzna: 53.1, dlugosc_geograficzna: 17.95 }, { keeperEmail: 'opiekun@example.org' })))
    const approved = await json(post(`/admin/device-submissions/${second.id}/approve`, {}, OPERATOR))
    expect(approved).toMatchObject({ device: { publication: 'official' }, keeper: 'sent' })
    expect(approved.device.id).not.toBe(firstDevice)

    expect((await get(`/v1/aed/${firstDevice}`)).status).toBe(200)
    expect(await shared()).toMatchObject({ official: 2 })
    const welcomes = (await outbox()).filter((message) => message.reason === 'passports_ready' && message.recipient === 'opiekun@example.org')
    expect(welcomes.map((message) => message.aedId).sort()).toEqual([firstDevice, approved.device.id].sort())
  })

  it("only fills the gaps of an institution's device, and does not hand its keeper link to the reporter", async () => {
    const { store } = await getContext()
    const city = store.aeds.find((aed) => aed.record.nazwa === 'Urząd Miasta Legionowo')!
    expect(city.record.godziny_dostepnosci).toBeNull()
    cityDevice = city.id

    // About 2 m from the device of the town hall, under the same name.
    await knownPoint(52.39522, 20.93138, LEGIONOWO)
    const sent = await json(submit(report({ nazwa: 'Urząd Miasta Legionowo', szerokosc_geograficzna: 52.39522, dlugosc_geograficzna: 20.93138, opis_lokalizacji: 'Hol główny' }, { keeperEmail: 'ktos@example.org' })))
    const waiting = (await queue()).find((item) => item.id === sent.id)
    expect(waiting.duplicateOf).toMatchObject({ id: city.id, decision: 'auto', publication: 'official' })

    const approved = await json(post(`/admin/device-submissions/${sent.id}/approve`, {}, OPERATOR))
    expect(approved).toMatchObject({ device: { id: city.id, publication: 'official' }, keeper: 'shared' })
    const merged = (await json(get(`/v1/aed/${city.id}`))).record
    expect(merged).toMatchObject({ nazwa: 'Urząd Miasta Legionowo', nazwa_ulicy: 'Piłsudskiego', godziny_dostepnosci: 'Mo-Fr 08:00-16:00', opis_lokalizacji: 'Hol główny' })
    expect(merged.zrodlo).toContain('Urząd Miasta Legionowo')
    expect(merged.zrodlo).toContain('Zgłoszenia użytkowników Mapy serc')
    expect((await outbox()).some((message) => message.recipient === 'ktos@example.org')).toBe(false)
  })

  it('flags a report of a device that an earlier report already brought in', async () => {
    await knownPoint(53.09512, 17.9172, BIALE_BLOTA)
    const again = await json(submit(report({ szerokosc_geograficzna: 53.09512 })))
    const waiting = (await queue()).find((item) => item.id === again.id)
    expect(waiting.duplicateOf).toMatchObject({ id: firstDevice, publication: 'official' })

    expect((await del(`/admin/device-submissions/${again.id}`)).status).toBe(401)
    expect((await del(`/admin/device-submissions/${again.id}`, OPERATOR)).status).toBe(200)
    expect((await del(`/admin/device-submissions/${again.id}`, OPERATOR)).status).toBe(404)
    expect((await queue()).some((item) => item.id === again.id)).toBe(false)
  })

  it('takes an approved report back out: its own device goes, a shared one loses only what the report added', async () => {
    expect((await del(`/admin/aed/${firstDevice}/user-report`)).status).toBe(401)
    expect(await json(del(`/admin/aed/${firstDevice}/user-report`, OPERATOR))).toEqual({ id: firstDevice, removed: true })
    expect((await get(`/v1/aed/${firstDevice}`)).status).toBe(404)
    expect(await shared()).toMatchObject({ official: 2 })

    expect((await del(`/admin/aed/${cityDevice}/user-report`, OPERATOR)).status).toBe(200)
    const city = await json(get(`/v1/aed/${cityDevice}`))
    expect(city.record).toMatchObject({ nazwa: 'Urząd Miasta Legionowo', godziny_dostepnosci: null, opis_lokalizacji: null })
    expect((await del(`/admin/aed/${cityDevice}/user-report`, OPERATOR)).status).toBe(404)
  })

  it('waits for the commune register before publishing, then publishes', async () => {
    // Registers silent when the report came: it is taken anyway, without a commune.
    const silent = await json(submit(report({ nazwa: 'Biblioteka', szerokosc_geograficzna: 50.06143, dlugosc_geograficzna: 19.93658 })))
    expect((await queue()).find((item) => item.id === silent.id).record.kod_terc).toBeNull()
    expect((await post(`/admin/device-submissions/${silent.id}/approve`, {}, OPERATOR)).status).toBe(503)

    await knownPoint(50.06143, 19.93658, { terc: '1261011', gmina: 'Kraków', powiat: 'Kraków', wojewodztwo: 'małopolskie' })
    const approved = await json(post(`/admin/device-submissions/${silent.id}/approve`, {}, OPERATOR))
    expect(approved).toMatchObject({ device: { publication: 'official' }, keeper: 'not_asked' })
    expect((await json(get(`/v1/aed/${approved.device.id}`))).record).toMatchObject({ kod_terc: '1261011', miejscowosc: 'Kraków' })
  })

  it('takes at most ten waiting reports a day from one person', async () => {
    const one = { 'X-Forwarded-For': '10.9.9.9' }
    for (let index = 0; index < 10; index++) expect((await submit(report({ nazwa: `Szkoła nr ${index + 1}` }), one)).status).toBe(200)
    const eleventh = await submit(report({ nazwa: 'Szkoła nr 11' }), one)
    expect(eleventh.status).toBe(409)
    expect((await json(eleventh)).detail).toContain('Wgraj listę z pliku')
    expect((await submit(report({ nazwa: 'Szkoła nr 11' }), { 'X-Forwarded-For': '10.9.9.10' })).status).toBe(200)
  })
})

describe('address lookups for the form', () => {
  it('gives the address nearest to a point, and says so when the register is silent', async () => {
    expect(await json(get('/v1/geo/nearest?at=17.9172,53.0951', someone()))).toEqual({
      address: { label: 'Szubińska 7, Białe Błota', lat: 53.09511, lon: 17.91722, city: 'Białe Błota', street: 'Szubińska', number: '7', postcode: '86-005' },
    })
    expect((await get('/v1/geo/nearest?at=21.5,51.5', someone())).status).toBe(503)
    expect((await get('/v1/geo/nearest?at=Legionowo', someone())).status).toBe(422)
  })

  it('finds an address typed in', async () => {
    const { store } = await getContext()
    await store.geoCache().set('uug:białe błota, szubińska 7', SZUBINSKA_7)
    expect((await json(get(`/v1/geo/address?q=${encodeURIComponent(' Białe Błota, Szubińska 7 ')}`, someone()))).address).toMatchObject({ label: 'Szubińska 7, Białe Błota', lat: 53.09511 })
  })

  it('lets one person ask at most 60 times in 10 minutes', async () => {
    const one = { 'X-Forwarded-For': '10.8.8.8' }
    for (let index = 0; index < 60; index++) expect((await get('/v1/geo/nearest?at=17.9172,53.0951', one)).status).toBe(200)
    expect((await get('/v1/geo/nearest?at=17.9172,53.0951', one)).status).toBe(503)
    expect((await get('/v1/geo/nearest?at=17.9172,53.0951', { 'X-Forwarded-For': '10.8.8.9' })).status).toBe(200)
  })
})

describe('the admin endpoints across origins', () => {
  it('answers the browser question before an operator request from the site', async () => {
    const response = await app.request('/admin/device-submissions', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'authorization' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(response.headers.get('access-control-allow-methods')).toContain('DELETE')
  })
})

describe('merging a user report', () => {
  const def = (id: string, kind: SourceDef['kind'], licence: SourceDef['licence'] = 'CC0 1.0'): SourceDef => ({ id, kind, name: id, attribution: id, licence, url: '', format: 'csv', mapping: {} })
  const sources = new Map([
    ['osm-pl', def('osm-pl', 'osm', 'ODbL 1.0')],
    ['miasto', def('miasto', 'official', 'CC BY 4.0')],
    [USER_SOURCE.id, USER_SOURCE],
  ])
  const member = (sourceId: string, input: NormalizedRecord['input']): NormalizedRecord => ({
    sourceId,
    sourceKey: `${sourceId}-1`,
    input: { szerokosc_geograficzna: 52.4, dlugosc_geograficzna: 20.93, kod_terc: '1408011', miejscowosc: 'Legionowo', ...input },
    raw: {},
    fixes: [],
    issues: [],
  })
  const context = { sources, existingIds: new Map<string, string>(), today: '2026-11-21' }

  it('makes a device known only from OpenStreetMap official, with the values of the report', () => {
    const merged = mergeCluster([member('osm-pl', { nazwa: 'Defibrylator AED', godziny_dostepnosci: '24/7' }), member(USER_SOURCE.id, { nazwa: 'Dworzec PKP' })], context)
    expect(merged).toMatchObject({ publication: 'official', record: { nazwa: 'Dworzec PKP', godziny_dostepnosci: null, licencja: 'CC0 1.0' } })
    expect(merged.sources.find((ref) => ref.sourceId === 'osm-pl')?.role).toBe('corroborates')
  })

  it("keeps the institution's values and fills only what it left empty", () => {
    const merged = mergeCluster([member(USER_SOURCE.id, { nazwa: 'Ratusz', godziny_dostepnosci: '24/7' }), member('miasto', { nazwa: 'Urząd Miasta' })], context)
    expect(merged.record).toMatchObject({ nazwa: 'Urząd Miasta', godziny_dostepnosci: '24/7', licencja: 'CC BY 4.0' })
    expect(merged.provenance).toMatchObject({ nazwa: 'miasto', godziny_dostepnosci: USER_SOURCE.id })
  })
})
