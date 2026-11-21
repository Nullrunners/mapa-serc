/** Logging in "with mObywatel" (the stand-in provider): sessions, devices of an account, and who confirmed a device. */
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { getContext } from '../src/context'
import { shortName } from '../src/auth/identity'
import { signLink } from '../src/radar/links'

const app = createApp()
const OPERATOR = { Authorization: 'Bearer test-token' }
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })

const login = async (person: string) => (await (await post('/v1/auth/login/demo', { person })).json()) as any
const ownerToken = async (aedId: string, rotate = false) => new URL(((await (await post(`/admin/aed/${aedId}/owner-link`, { rotate }, OPERATOR)).json()) as any).ownerUrl).searchParams.get('t')!

let id = ''
let other = ''
let anna = ''
let jan = ''

beforeAll(async () => {
  expect((await post('/admin/jobs/pipeline', {}, OPERATOR)).status).toBe(200)
  const { store } = await getContext()
  // Devices no other test file touches, so the order of the files does not matter.
  const free = store.aeds.filter((aed) => aed.publication === 'official' && aed.record.miejscowosc === 'Krosno' && !store.passports.get(aed.id))
  id = free[0]!.id
  other = free[1]!.id
})

describe('logging in', () => {
  it('offers the made-up people and says it is a stand-in', async () => {
    const options = (await (await get('/v1/auth/login')).json()) as any
    expect(options.mode).toBe('demo')
    expect(options.people.map((person: any) => person.id)).toEqual(['anna', 'jan', 'maria'])
  })

  it('opens a session for a known person only', async () => {
    expect((await post('/v1/auth/login/demo', { person: 'nikt' })).status).toBe(422)
    const session = await login('anna')
    anna = session.session
    expect(session.account).toEqual({ name: 'Anna P.', provider: 'demo', devices: [] })
    expect(session.expiresAt).toBe('2026-11-22T00:00:00.000Z')
    jan = (await login('jan')).session
  })

  it('keeps one account per person and stores no surname and no identifier', async () => {
    await login('anna')
    const { db } = await getContext()
    const rows = await db.all<{ name: string; subject_key: string }>('SELECT name, subject_key FROM keeper_account')
    expect(rows.map((row) => row.name).sort()).toEqual(['Anna P.', 'Jan P.'])
    expect(JSON.stringify(rows)).not.toMatch(/Przykładowa|demo:anna/)
    expect(shortName('Maria', 'Testowa')).toBe('Maria T.')
  })

  it('refuses a session that is forged, made for something else, or has ended', async () => {
    const account = async (session: string) => (await get('/v1/account', { 'X-Keeper-Session': session })).status
    expect(await account(anna)).toBe(200)
    expect(await account(`${anna.split('.')[0]}.forged-signature-forged-signature-forged0000`)).toBe(401)
    const { store } = await getContext()
    const accountId = (await store.keepers.signIn('demo', 'someone', 'Ktoś K.', '2026-11-21T12:00:00.000Z')).id
    // An owner link is not a session, and neither is a session whose time is up.
    expect(await account(signLink('owner', accountId, 0))).toBe(401)
    expect(await account(signLink('session', accountId, Date.parse('2026-11-21T11:59:59.000Z') / 1000))).toBe(401)
    expect(await account(signLink('session', accountId, Date.parse('2026-11-21T12:00:01.000Z') / 1000))).toBe(200)
    expect((await get('/v1/account')).status).toBe(422)
  })
})

describe('devices of an account', () => {
  const as = (session: string, extra: Record<string, string> = {}) => ({ 'X-Keeper-Session': session, ...extra })

  it('does not let a logged-in person into a device just because they logged in', async () => {
    expect((await get(`/v1/owner/passport?id=${id}`, as(anna))).status).toBe(401)
    expect((await post(`/v1/owner/passport/confirm?id=${id}`, {}, as(anna))).status).toBe(401)
    expect((await get('/v1/owner/passport')).status).toBe(401)
  })

  it('adds a device to the account of whoever also holds its owner link', async () => {
    const token = await ownerToken(id)
    expect((await post('/v1/account/devices', {}, as(anna, { 'X-Owner-Token': 'not-a-real-owner-link' }))).status).toBe(401)
    expect((await post('/v1/account/devices', {}, { 'X-Owner-Token': token })).status).toBe(422)

    const before = (await (await get('/v1/owner/passport', as(anna, { 'X-Owner-Token': token }))).json()) as any
    expect(before.viewer).toEqual({ name: 'Anna P.', linked: false })

    const account = (await (await post('/v1/account/devices', {}, as(anna, { 'X-Owner-Token': token }))).json()) as any
    expect(account.devices.map((device: any) => device.id)).toEqual([id])
    // Adding it again changes nothing.
    expect(((await (await post('/v1/account/devices', {}, as(anna, { 'X-Owner-Token': token }))).json()) as any).devices).toHaveLength(1)
  })

  it('then lets that person in without the link, and nobody else', async () => {
    const view = (await (await get(`/v1/owner/passport?id=${id}`, as(anna))).json()) as any
    expect(view.aed.id).toBe(id)
    expect(view.viewer).toEqual({ name: 'Anna P.', linked: true })
    expect(view.keepers).toEqual([{ name: 'Anna P.', linkedAt: '2026-11-21T12:00:00.000Z' }])
    expect((await get(`/v1/owner/passport?id=${id}`, as(jan))).status).toBe(401)
    expect((await get(`/v1/owner/passport?id=${other}`, as(anna))).status).toBe(401)
  })

  it('saves changes made by a logged-in keeper', async () => {
    const view = (await (await post(`/v1/owner/passport?id=${id}`, { batteryExp: '2028-01-31' }, as(anna))).json()) as any
    expect(view.aed.record.termin_waznosci_baterii).toBe('2028-01-31')
  })

  it('shows that a confirmation came from a logged-in person, and from whom only to keepers', async () => {
    const view = (await (await post(`/v1/owner/passport/confirm?id=${id}`, {}, as(anna))).json()) as any
    expect(view.passport).toMatchObject({ confirmedAt: '2026-11-21', confirmedBy: 'Anna P.' })
    const card = (await (await get(`/v1/aed/${id}/passport`)).json()) as any
    expect(card).toMatchObject({ confirmedByKeeper: true, confirmedIdentity: 'demo' })
    expect(JSON.stringify(card)).not.toContain('Anna')

    // The same click by somebody with the link alone carries no name.
    const byLink = (await (await post('/v1/owner/passport/confirm', {}, { 'X-Owner-Token': await ownerToken(id) })).json()) as any
    expect(byLink.passport.confirmedBy).toBeNull()
    expect(byLink.public.confirmedIdentity).toBeNull()
    expect(byLink.viewer).toBeNull()
  })

  it('lets a keeper take a device off their own account, and no one else\'s', async () => {
    const token = await ownerToken(other)
    await post('/v1/account/devices', {}, as(anna, { 'X-Owner-Token': token }))
    await post('/v1/account/devices', {}, as(jan, { 'X-Owner-Token': token }))
    const left = (await (await post(`/v1/account/devices/${other}/remove`, {}, as(anna))).json()) as any
    expect(left.devices.map((device: any) => device.id)).toEqual([id])
    expect((await get(`/v1/owner/passport?id=${other}`, as(anna))).status).toBe(401)
    expect((await get(`/v1/owner/passport?id=${other}`, as(jan))).status).toBe(200)
    // The link still works: taking a device off an account is not giving it up.
    expect((await get('/v1/owner/passport', { 'X-Owner-Token': token })).status).toBe(200)
  })

  it('takes the device off every account when the operator revokes the links', async () => {
    await ownerToken(id, true)
    expect((await get(`/v1/owner/passport?id=${id}`, as(anna))).status).toBe(401)
    expect(((await (await get('/v1/account', as(anna))).json()) as any).devices).toEqual([])
  })
})
