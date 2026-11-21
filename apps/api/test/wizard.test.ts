/** The provider wizard over HTTP, in-process: preview a file, submit it, approve it, download it back. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { suggestMapping, toMapping } from '../src/pipeline/mapping'
import { parseCsv } from '../src/pipeline/parse'
import { parseDelimited } from '../src/pipeline/parse'

const app = createApp()
const OPERATOR = { Authorization: 'Bearer test-token' }
const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, 'fixtures/sources', name))

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

// A file as a small town hall would export it from a spreadsheet: semicolons, decimal commas, Polish hours.
const NEW_TOWN = [
  'Obiekt;Ulica;Kod;Miasto;TERYT;Szer. geogr.;Dł. geogr.;Godziny otwarcia;Telefon;Gdzie',
  'Urząd Gminy Testowo;ul. Długa 12;86-005;Białe Błota;0403022;53,0951;17,9172;pn-pt 7.30-15.30;52 381 14 13;Parter, przy kasie',
  'Hala sportowa;ul. Centralna 27;86-005;Białe Błota;0403022;53,0972;17,9201;całodobowo;;Na zewnątrz, przy wejściu głównym',
].join('\r\n')

const upload = (text: string | Buffer, fileName: string, extra: object = {}) => ({ fileName, contentBase64: Buffer.from(text).toString('base64'), ...extra })

beforeAll(async () => {
  const response = await post('/admin/jobs/pipeline', {}, OPERATOR)
  expect(response.status).toBe(200)
})

describe('column mapping proposal', () => {
  it('reads the Marki file correctly although its coordinate headers are the wrong way round', () => {
    const mapping = toMapping(suggestMapping(parseCsv(fixture('marki.csv'))))
    expect(mapping).toEqual({
      'Długość geograficzna': 'szerokosc_geograficzna',
      'Szerokość geograficzna': 'dlugosc_geograficzna',
      Nazwa: null,
      Lokalizacja: 'nazwa',
      Adres: 'adres',
      'Numer Id': 'id_w_zrodle',
    })
  })

  it('maps a file that already follows the pattern onto itself', () => {
    const table = parseCsv(fixture('legionowo.csv'))
    expect(toMapping(suggestMapping(table))).toEqual(Object.fromEntries(table.headers.map((header) => [header, header])))
  })

  it('understands spreadsheet-style headers and values', () => {
    expect(toMapping(suggestMapping(parseCsv(NEW_TOWN)))).toEqual({
      Obiekt: 'nazwa',
      Ulica: 'ulica',
      Kod: 'kod_pocztowy',
      Miasto: 'miejscowosc',
      TERYT: 'kod_terc',
      'Szer. geogr.': 'szerokosc_geograficzna',
      'Dł. geogr.': 'dlugosc_geograficzna',
      'Godziny otwarcia': 'godziny_dostepnosci',
      Telefon: 'telefon_kontaktowy',
      Gdzie: 'opis_lokalizacji',
    })
  })
})

describe('preview', () => {
  it('shows fixes, problems and devices already in the dataset', async () => {
    const response = await post('/v1/import/preview', upload(fixture('marki.csv'), 'aed-marki.csv'))
    expect(response.status).toBe(200)
    const preview = (await response.json()) as any
    expect(preview.stub).toBe(false)
    expect(preview.fileFixes.map((fix: any) => fix.code)).toContain('whole_line_quoted')
    expect(preview.summary).toMatchObject({ rows: 8, ready: 7, withErrors: 1, duplicates: 7 })
    const office = preview.rows.find((row: any) => row.record.nazwa === 'Urząd Miasta Marki')
    expect(office.duplicateOf).toMatchObject({ nazwa: 'Urząd Miasta Marki', decision: 'auto', publication: 'official' })
    expect(preview.columns.find((column: any) => column.header === 'Długość geograficzna').reason).toContain('choć nazwa kolumny wskazuje')
  })

  it('rejects what is not a table and unknown mapping targets', async () => {
    expect((await post('/v1/import/preview', upload('to nie jest tabela', 'notatka.txt'))).status).toBe(400)
    const wrong = await post('/v1/import/preview', upload(NEW_TOWN, 'aed.csv', { mapping: { Obiekt: 'nie_ma_takiego_pola' } }))
    expect(wrong.status).toBe(422)
    const system = await post('/v1/import/preview', upload(NEW_TOWN, 'aed.csv', { mapping: { Obiekt: 'licencja' } }))
    expect(system.status).toBe(422)
  })
})

describe('commit and approval', () => {
  const provider = { name: 'Urząd Gminy Testowo', licence: 'CC0 1.0' }
  let sourceId: string
  const counts = async () => ((await (await app.request('/health')).json()) as any).counts
  const csvRows = async (path: string) => parseDelimited(await (await app.request(path)).text(), ',')

  it('keeps an unauthenticated submission out of the published dataset', async () => {
    const before = await counts()
    const response = await post('/v1/import/commit', upload(NEW_TOWN, 'aed-testowo.csv', { provider }))
    expect(response.status).toBe(200)
    const result = (await response.json()) as any
    expect(result).toMatchObject({ stub: false, status: 'pending', added: 2, merged: 0, incomplete: 0 })
    sourceId = result.sourceId

    expect(await counts()).toEqual({ ...before, pending: 2 })
    // Nothing goes to dane.gov.pl before approval: no feed link, and the feed itself refuses.
    expect(result.files.feed).toBeNull()
    expect((await app.request(`/feeds/dostawcy/${sourceId}/dane-gov-pl.xml`)).status).toBe(409)
    expect(await csvRows('/dane/aed.csv')).toHaveLength(before.official + 1)
    const map = (await (await app.request('/v1/aed.geojson?layer=all')).json()) as any
    expect(map.features.some((feature: any) => feature.properties.nazwa === 'Urząd Gminy Testowo')).toBe(false)
  })

  it('needs the operator token to approve', async () => {
    expect((await post(`/admin/sources/${sourceId}/approve`, {})).status).toBe(401)
    expect((await post('/admin/sources/no-such-source/approve', {}, OPERATOR)).status).toBe(404)
  })

  it('publishes the devices once approved, normalised to the pattern', async () => {
    const before = await counts()
    const response = await post(`/admin/sources/${sourceId}/approve`, {}, OPERATOR)
    expect(response.status).toBe(200)
    expect((await response.json()) as any).toMatchObject({ status: 'published', added: 2 })
    expect(await counts()).toEqual({ ...before, official: before.official + 2, pending: 0 })

    const list = (await (await app.request('/v1/aed?q=Testowo')).json()) as any
    expect(list.items[0].record).toMatchObject({
      nazwa: 'Urząd Gminy Testowo',
      cecha_ulicy: 'ulica',
      nazwa_ulicy: 'Długa',
      nr_budynku: '12',
      kod_pocztowy: '86-005',
      miejscowosc: 'Białe Błota',
      kod_terc: '0403022',
      szerokosc_geograficzna: 53.0951,
      dlugosc_geograficzna: 17.9172,
      godziny_dostepnosci: 'Mo-Fr 07:30-15:30',
      telefon_kontaktowy: '+48523811413',
      opis_lokalizacji: 'Parter, przy kasie',
      zrodlo: 'Urząd Gminy Testowo (zgłoszenie w Mapie serc)',
      licencja: 'CC0 1.0',
    })

    const own = await csvRows(`/v1/sources/${sourceId}/aed.csv`)
    expect(own).toHaveLength(3)

    // The provider publishes its own dataset in dane.gov.pl, tagged for the portal's summary list.
    const sources = ((await (await app.request('/v1/sources')).json()) as any).items as any[]
    const feedUrl: string = sources.find((source) => source.id === sourceId).feedUrl
    expect(feedUrl.endsWith(`/feeds/dostawcy/${sourceId}/dane-gov-pl.xml`)).toBe(true)
    const feed = await (await app.request(new URL(feedUrl).pathname)).text()
    expect(feed).toContain('<tag lang="pl">wykaz-aed</tag>')
    expect(feed).toContain(`/v1/sources/${sourceId}/aed.csv</url>`)
    expect(feed).toContain('<dbOrCopyrightedLicenseChosen>CC0 1.0</dbOrCopyrightedLicenseChosen>')
    expect(feed).toContain('Defibrylatory AED – Urząd Gminy Testowo')
    const detail = (await (await app.request(`/v1/aed/${list.items[0].id}`)).json()) as any
    expect(detail.sources).toEqual([expect.objectContaining({ sourceId, role: 'values', name: 'Urząd Gminy Testowo' })])
  })

  it('replaces the earlier submission when the same file is sent again', async () => {
    const before = await counts()
    const response = await post('/v1/import/commit', upload(NEW_TOWN, 'aed-testowo.csv', { provider }), OPERATOR)
    expect((await response.json()) as any).toMatchObject({ status: 'published', sourceId, added: 2 })
    expect(await counts()).toEqual(before)
  })

  it('refuses a commit without the provider name', async () => {
    expect((await post('/v1/import/commit', upload(NEW_TOWN, 'aed.csv'))).status).toBe(422)
  })
})

describe('passports for the provider', () => {
  // Pattern headers map onto themselves; the electrodes expire 4 days after the tests' fixed "today" (2026-11-21).
  const FILE = [
    'nazwa,miejscowosc,kod_terc,szerokosc_geograficzna,dlugosc_geograficzna,termin_waznosci_elektrod',
    'Szkoła Podstawowa w Próbnej Woli,Białe Błota,0403022,53.1205,17.9604,2026-11-25',
  ].join('\r\n')
  const provider = { name: 'Gmina Próbna Wola', email: 'aed@probna.example', licence: 'CC0 1.0' }
  const outbox = async () => ((await (await app.request('/admin/outbox?limit=500', { headers: OPERATOR })).json()) as any).items as any[]

  it('sends the sticker and passport links once the operator approves, and never publishes the address', async () => {
    const result = (await (await post('/v1/import/commit', upload(FILE, 'aed-proba.csv', { provider }))).json()) as any
    expect(result).toMatchObject({ status: 'pending', added: 1, devices: [] })
    expect((await outbox()).some((message) => message.recipient === provider.email)).toBe(false)

    const approved = (await (await post(`/admin/sources/${result.sourceId}/approve`, {}, OPERATOR)).json()) as any
    expect(approved.devices).toHaveLength(1)
    const welcome = (await outbox()).find((message) => message.reason === 'passports_ready')
    expect(welcome).toMatchObject({ recipient: provider.email, channel: 'email', aedId: approved.devices[0].id })
    expect(welcome.body).toContain(approved.devices[0].stickerUrl)
    expect(welcome.body).toContain(approved.devices[0].ownerUrl)

    for (const path of ['/v1/sources', '/dane/aed.csv', '/v1/aed.geojson?layer=all', `/v1/aed/${approved.devices[0].id}`, `/v1/aed/${approved.devices[0].id}/passport`]) {
      expect(await (await app.request(path)).text()).not.toContain(provider.email)
    }
  })

  it('reminds the provider of the expiry date from the file', async () => {
    expect((await post('/admin/jobs/reminders', {}, OPERATOR)).status).toBe(200)
    const reminder = (await outbox()).find((message) => message.reason === 'reminder' && message.recipient === provider.email)
    expect(reminder.body).toContain('elektrody dla dorosłych: ważne do 25.11.2026 (zostało 4 dni)')
  })
})

describe('feeds for dane.gov.pl', () => {
  it('gives every official source a feed of its own, but not OpenStreetMap', async () => {
    const sources = ((await (await app.request('/v1/sources')).json()) as any).items as any[]
    const city = sources.find((source) => source.id === 'dane-gov-pl-54632')
    expect(city.feedUrl).toBe('https://api.aed.example.gov.pl/feeds/dostawcy/dane-gov-pl-54632/dane-gov-pl.xml')
    expect(await (await app.request(new URL(city.feedUrl).pathname)).text()).toContain('/v1/sources/dane-gov-pl-54632/aed.csv</url>')
    const osm = sources.find((source) => source.kind === 'osm')
    expect(osm.feedUrl).toBeNull()
    expect((await app.request(`/feeds/dostawcy/${osm.id}/dane-gov-pl.xml`)).status).toBe(409)
    expect((await app.request('/feeds/dostawcy/nie-ma-takiego/dane-gov-pl.xml')).status).toBe(404)
  })
})
