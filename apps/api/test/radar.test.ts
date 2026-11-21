/** Radar: which notices count as leads, how community devices are grouped, and the invitation round trip. */
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { getContext } from '../src/context'
import type { Store } from '../src/db/store'
import type { MergedAed } from '../src/pipeline/merge'
import { isPublicAedPurchase, osmGapCandidates, rank, type Candidate } from '../src/radar/build'
import { signInvitation, verifyInvitation } from '../src/radar/links'

const notice = (organizationName: string, orderObject: string, procedureResult = 'zawarcieUmowy') => ({
  objectId: 'x',
  bzpNumber: '2026/BZP 00000001',
  tenderId: 't',
  noticeNumber: '2026/BZP 00000001/01',
  publicationDate: '2026-03-12T10:00:00Z',
  orderObject,
  procedureResult,
  organizationName,
  organizationCity: 'Kołobrzeg',
  organizationNationalId: null,
})

describe('procurement notices', () => {
  it('keeps purchases of public AEDs by public buyers', () => {
    expect(isPublicAedPurchase(notice('Gmina Miasto Kołobrzeg', 'DefiCity – Bezpieczne miasto Kołobrzeg - Defibrylatory AED w miejscach publicznych'))).toBe(true)
    expect(isPublicAedPurchase(notice('Gmina Piła', 'Zakup 14 zestawów defibrylatorów z tablicami informacyjnymi wraz z ich instalacją.'))).toBe(true)
  })

  it('drops hospital equipment, implants, training devices and cancelled tenders', () => {
    expect(isPublicAedPurchase(notice('Uniwersytecki Szpital Kliniczny w Poznaniu', 'Zakup aparatów EKG oraz defibrylatorów'))).toBe(false)
    expect(isPublicAedPurchase(notice('Gmina Piła', 'Zakup 2 szt. defibrylatorów szpitalnych dla Szpitala Specjalistycznego w Pile'))).toBe(false)
    expect(isPublicAedPurchase(notice('Powiat Testowy', 'Dostawa kardiowerterów – defibrylatorów i akcesoria do ich implantacji'))).toBe(false)
    expect(isPublicAedPurchase(notice('Województwo Mazowieckie', 'Zakup fantomów i AED'))).toBe(false)
    expect(isPublicAedPurchase(notice('GMINA MIASTO SZCZECIN', 'Dostawa, montaż i podłączenie 50 defibrylatorów AED w kapsułach zewnętrznych.', 'uniewaznienie'))).toBe(false)
  })
})

const aed = (id: string, publication: MergedAed['publication'], terc: string, miejscowosc: string, operator: string | null): MergedAed =>
  ({ id, publication, quality: 50, provenance: {}, sources: [], issues: [], record: { id, nazwa: id, kod_terc: terc, miejscowosc, podmiot_odpowiedzialny: operator, szerokosc_geograficzna: 53.1, dlugosc_geograficzna: 18.0 } }) as unknown as MergedAed

describe('community devices missing from the official dataset', () => {
  const store = {
    aeds: [
      ...Array.from({ length: 6 }, (_, index) => aed(`b${index}`, 'community', '0461011', 'Bydgoszcz', index < 5 ? 'PKP Intercity' : 'pkp intercity')),
      aed('k1', 'community', '1861011', 'Krosno', null),
      aed('k2', 'official', '1861011', 'Krosno', null),
    ],
    communeNames: () => new Map([['0461011', 'Bydgoszcz']]),
  } as unknown as Store

  it('groups them by commune and sets them against the official count', () => {
    const leads = osmGapCandidates(store, '2026-11-21')
    expect(leads.find((lead) => lead.id === 'osm-gmina-0461011')).toMatchObject({ kind: 'osm_gap', devices: 6, registered: 0, locality: 'Bydgoszcz', title: 'Bydgoszcz: 6 urządzeń na mapie społeczności, 0 w zbiorze urzędowym' })
    expect(leads.find((lead) => lead.id === 'osm-gmina-1861011')).toMatchObject({ devices: 1, registered: 1, title: 'Krosno: 1 urządzenie na mapie społeczności, 1 w zbiorze urzędowym' })
  })

  it('finds operators with many devices whatever the spelling', () => {
    const operator = osmGapCandidates(store, '2026-11-21').find((lead) => lead.id === 'osm-operator-pkp-intercity')
    expect(operator).toMatchObject({ organisation: 'PKP Intercity', devices: 6, title: 'PKP Intercity: 6 urządzeń w 1 gminie na mapie społeczności' })
  })

  it('ranks the largest leads first', () => {
    expect(rank(osmGapCandidates(store, '2026-11-21'))[0]!.devices).toBe(6)
  })
})

describe('invitation links', () => {
  it('round-trips a lead id and rejects a tampered token', () => {
    const token = signInvitation('osm-gmina-0461011')
    expect(verifyInvitation(token)).toBe('osm-gmina-0461011')
    expect(verifyInvitation(token.slice(0, -2) + 'xx')).toBeNull()
    expect(verifyInvitation(`${Buffer.from('osm-gmina-9999999').toString('base64url')}.${token.split('.')[1]}`)).toBeNull()
    expect(verifyInvitation('nonsense')).toBeNull()
  })
})

describe('from lead to published devices', () => {
  const app = createApp()
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const lead: Candidate = {
    id: 'osm-gmina-0403022',
    kind: 'osm_gap',
    status: 'new',
    title: 'Białe Błota: 2 urządzenia na mapie społeczności, 0 w zbiorze urzędowym',
    organisation: null,
    nip: null,
    kodTerc: '0403022',
    locality: 'Białe Błota',
    devices: 2,
    registered: 0,
    evidence: { url: 'https://openaedmap.org/', quote: '2 obiekty', date: '2026-11-21' },
    confidence: 0.9,
    lat: 53.09,
    lon: 17.92,
  }
  const file = ['nazwa;miejscowosc;kod_terc;szerokosc_geograficzna;dlugosc_geograficzna', 'Remiza OSP Radarowo;Białe Błota;0403022;53,0911;17,9133'].join('\n')

  it('lets only an operator decide, and publishes the invited owner\'s submission at once', async () => {
    const { store } = await getContext()
    await store.saveCandidates([lead])

    const list = (await (await app.request('/v1/candidates?kind=osm_gap')).json()) as any
    expect(list).toMatchObject({ stub: false, total: 1 })

    expect((await post(`/v1/candidates/${lead.id}/decision`, { decision: 'invite' })).status).toBe(401)
    const decided = (await (await post(`/v1/candidates/${lead.id}/decision`, { decision: 'invite' }, { Authorization: 'Bearer test-token' })).json()) as any
    expect(decided.candidate.status).toBe('invited')
    const token = new URL(decided.confirmationUrl).searchParams.get('zaproszenie')!
    expect(decided.confirmationUrl.startsWith('http://localhost:3000/dostawca?zaproszenie=')).toBe(true)

    const body = { fileName: 'osp.csv', contentBase64: Buffer.from(file).toString('base64'), provider: { name: 'OSP Radarowo', licence: 'CC0 1.0' } }
    expect((await post('/v1/import/commit', { ...body, invitation: 'forged.token' })).status).toBe(422)
    const committed = (await (await post('/v1/import/commit', { ...body, invitation: token })).json()) as any
    expect(committed).toMatchObject({ status: 'published', added: 1 })

    expect(store.candidates.find((candidate) => candidate.id === lead.id)!.status).toBe('confirmed')
    const found = (await (await app.request('/v1/aed?q=Radarowo')).json()) as any
    expect(found.items[0]).toMatchObject({ publication: 'official' })
    expect((await (await app.request(`/v1/aed/${found.items[0].id}`)).json() as any).history).toEqual([])
  })
})
