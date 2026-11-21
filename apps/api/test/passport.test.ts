/** Cyfrowy Paszport AED: keeper links, "Potwierdzam sprawność", reports of passers-by and expiry reminders. */
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { getContext } from '../src/context'
import { supplyFor } from '../src/gaps/state'
import { normalisePhone } from '../src/passport/handlers'
import { dueWindow, expiryState, maskEmail, summariseReports, type FieldReport } from '../src/passport/model'
import { notWorking, REPORTS_PER_DEVICE_DAY } from '../src/passport/service'
import { signInvitation, verifyInvitation } from '../src/radar/links'

const app = createApp()
const OPERATOR = { Authorization: 'Bearer test-token' }
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })

let id = ''

beforeAll(async () => {
  expect((await post('/admin/jobs/pipeline', {}, OPERATOR)).status).toBe(200)
  const { store } = await getContext()
  id = store.aeds.find((aed) => aed.publication === 'official' && aed.record.miejscowosc === 'Legionowo')!.id
})

describe('passport model', () => {
  it('tells how close an expiry date is', () => {
    expect(expiryState('2027-06-30', '2026-11-21').state).toBe('ok')
    expect(expiryState('2026-12-15', '2026-11-21')).toEqual({ state: 'soon', daysLeft: 24 })
    expect(expiryState('2026-11-20', '2026-11-21').state).toBe('expired')
    expect(expiryState(null, '2026-11-21').state).toBe('unknown')
    expect(dueWindow('2027-01-30', '2026-11-21')).toBeNull()
    expect(dueWindow('2026-12-21', '2026-11-21')).toBe('30')
    expect(dueWindow('2026-11-28', '2026-11-21')).toBe('7')
    expect(dueWindow('2026-11-20', '2026-11-21')).toBe('expired')
  })

  it('counts a problem only until the keeper confirms or a passer-by sees the device again', () => {
    const report = (kind: FieldReport['kind'], at: string): FieldReport => ({ id: at, aedId: 'x', kind, note: null, at, clientHash: 'h' })
    const reports = [report('missing', '2026-11-10T10:00:00.000Z'), report('ok', '2026-11-12T10:00:00.000Z'), report('locked', '2026-11-15T10:00:00.000Z')]
    expect(summariseReports(reports, null, '2026-11-21T12:00:00.000Z').problems.map((problem) => problem.kind)).toEqual(['locked'])
    expect(summariseReports(reports, '2026-11-16', '2026-11-21T12:00:00.000Z').problems).toEqual([])
    expect(summariseReports(reports, null, '2026-11-21T12:00:00.000Z').lastOk).toBe('2026-11-12T10:00:00.000Z')
  })

  it('counts the people who reported a problem, not their clicks', () => {
    const by = (hash: string, at: string): FieldReport => ({ id: `${hash}${at}`, aedId: 'x', kind: 'missing', note: null, at, clientHash: hash })
    const now = '2026-11-21T12:00:00.000Z'
    expect(summariseReports([by('a', '2026-11-20T08:00:00.000Z'), by('a', '2026-11-20T10:00:00.000Z')], null, now).problems[0]!.count).toBe(1)
    expect(summariseReports([by('a', '2026-11-20T08:00:00.000Z'), by('b', '2026-11-20T10:00:00.000Z')], null, now).problems[0]).toMatchObject({ count: 2, lastAt: '2026-11-20T10:00:00.000Z' })
  })

  it('normalises phone numbers and masks addresses', () => {
    expect(normalisePhone('600 100 200')).toBe('+48600100200')
    expect(normalisePhone('0048 600-100-200')).toBe('+48600100200')
    expect(normalisePhone('12345')).toBeNull()
    expect(maskEmail('sekretariat@legionowo.pl')).toBe('s***@legionowo.pl')
  })
})

describe('keeper of a device', () => {
  let token = ''
  const owner = () => ({ 'X-Owner-Token': token })

  it('gets a link from the operator only', async () => {
    expect((await post(`/admin/aed/${id}/owner-link`, {})).status).toBe(401)
    const links = (await (await post(`/admin/aed/${id}/owner-link`, {}, OPERATOR)).json()) as any
    expect(links.stickerUrl).toBe(`http://localhost:3000/aed/${id}/naklejka`)
    token = new URL(links.ownerUrl).searchParams.get('t')!
    expect((await get('/v1/owner/passport', owner())).status).toBe(200)
  })

  it('cannot use an owner link as an invitation, nor an invitation as an owner link', async () => {
    expect(verifyInvitation(token)).toBeNull()
    expect((await get('/v1/owner/passport', { 'X-Owner-Token': signInvitation(id) })).status).toBe(401)
    expect((await get('/v1/owner/passport', { 'X-Owner-Token': 'forged.token.value' })).status).toBe(401)
  })

  it('enters expiry dates and a private contact for reminders', async () => {
    const bad = await post('/v1/owner/passport', { notifyPhone: '12' }, owner())
    expect(bad.status).toBe(422)
    const view = (await (
      await post('/v1/owner/passport', { electrodesExp: '2026-12-15', electrodesChildExp: '2026-11-01', batteryExp: '2026-11-25', notifyEmail: 'serwis@example.org', notifyPhone: '600 100 200' }, owner())
    ).json()) as any
    expect(view.passport).toMatchObject({ notifyPhone: '+48600100200', notifyEmail: 'serwis@example.org' })
    expect(view.public.items.map((item: any) => item.state)).toEqual(['soon', 'expired', 'soon'])
    expect(view.aed.record.termin_waznosci_elektrod_pediatrycznych).toBe('2026-11-01')
    // The private contact never reaches the published record.
    expect(JSON.stringify(view.aed.record)).not.toContain('serwis@example.org')
  })

  it('confirms the device works, and the published dataset shows it at once and after the next merge', async () => {
    const view = (await (await post('/v1/owner/passport/confirm', {}, owner())).json()) as any
    expect(view.aed.record).toMatchObject({ status: 'czynny', data_weryfikacji: '2026-11-21' })
    expect(view.public).toMatchObject({ confirmedAt: '2026-11-21', confirmedByKeeper: true })
    expect(await (await get('/dane/aed.csv')).text()).toContain('2026-11-25')

    expect((await post('/admin/jobs/pipeline', {}, OPERATOR)).status).toBe(200)
    const detail = (await (await get(`/v1/aed/${id}`)).json()) as any
    expect(detail.record).toMatchObject({ status: 'czynny', data_weryfikacji: '2026-11-21', termin_waznosci_baterii: '2026-11-25' })
    expect(detail.provenance.data_weryfikacji).toBe('paszport')
  })

  it('gets each reminder once, by email and SMS', async () => {
    const first = (await (await post('/admin/jobs/reminders', {}, OPERATOR)).json()) as any
    expect(first.summary).toMatchObject({ devices: 1, messages: 2 })
    const again = (await (await post('/admin/jobs/reminders', {}, OPERATOR)).json()) as any
    expect(again.summary).toMatchObject({ messages: 0 })

    const outbox = (await (await get('/admin/outbox', OPERATOR)).json()) as any
    const reminders = outbox.items.filter((message: any) => message.reason === 'reminder')
    expect(reminders.map((message: any) => [message.channel, message.recipient, message.status])).toEqual(
      expect.arrayContaining([
        ['email', 'serwis@example.org', 'logged'],
        ['sms', '+48600100200', 'logged'],
      ]),
    )
    const email = reminders.find((message: any) => message.channel === 'email')
    expect(email.body).toContain('elektrody dla dzieci: termin minął 01.11.2026')
    expect(email.body).toContain('bateria: ważne do 25.11.2026 (zostało 4 dni)')
    expect(email.body).toContain('/opiekun?t=')
  })

  it('takes reports from passers-by, one per hour from one person, and tells the keeper about problems', async () => {
    const from = (ip: string) => ({ 'X-Forwarded-For': ip })
    const missing = (await (await post(`/v1/aed/${id}/reports`, { kind: 'missing' }, from('10.0.0.1'))).json()) as any
    expect(missing.outcome).toBe('accepted')
    expect(missing.passport.reports.problems).toEqual([expect.objectContaining({ kind: 'missing', count: 1 })])
    expect(((await (await post(`/v1/aed/${id}/reports`, { kind: 'locked' }, from('10.0.0.1'))).json()) as any).outcome).toBe('duplicate')

    const outbox = (await (await get('/admin/outbox', OPERATOR)).json()) as any
    const problems = outbox.items.filter((message: any) => message.reason === 'problem_report')
    expect(problems.map((message: any) => message.channel).sort()).toEqual(['email', 'sms'])
    expect(problems[0].subject).toContain('urządzenia nie ma na miejscu')

    const ok = (await (await post(`/v1/aed/${id}/reports`, { kind: 'ok' }, from('10.0.0.2'))).json()) as any
    expect(ok.passport.reports).toMatchObject({ okCount: 1, problems: [] })
  })

  it('stops counting the device in the gap analysis while electrodes are past their date', async () => {
    const { store } = await getContext()
    expect(supplyFor(store).points.find((point) => point.id === id)?.basis).toBe('excluded')
    await post('/v1/owner/passport', { electrodesChildExp: '2027-11-01' }, owner())
    expect(supplyFor(store).points.find((point) => point.id === id)?.basis).not.toBe('excluded')
  })

  it('loses access when the operator revokes the links', async () => {
    const fresh = (await (await post(`/admin/aed/${id}/owner-link`, { rotate: true }, OPERATOR)).json()) as any
    expect((await get('/v1/owner/passport', owner())).status).toBe(401)
    expect((await get('/v1/owner/passport', { 'X-Owner-Token': new URL(fresh.ownerUrl).searchParams.get('t')! })).status).toBe(200)
  })
})

describe('reports from passers-by', () => {
  let other = ''
  const report = async (kind: string, forwardedFor: string) => ((await (await post(`/v1/aed/${other}/reports`, { kind }, { 'X-Forwarded-For': forwardedFor })).json()) as any).outcome

  beforeAll(async () => {
    const { store } = await getContext()
    const broken = notWorking(store, '2026-11-21', '2026-11-21T12:00:00.000Z')
    other = store.aeds.find((aed) => aed.publication === 'official' && aed.id !== id && !store.passports.get(aed.id) && store.passports.reportsOf(aed.id).length === 0 && !broken.has(aed.id))!.id
  })

  it('leaves a device out of the gap analysis only when two different people report it missing', async () => {
    const { store } = await getContext()
    const missing = (clientHash: string, at: string) => store.passports.report({ aedId: other, kind: 'missing', note: null, at, clientHash })
    const broken = () => notWorking(store, '2026-11-21', '2026-11-21T12:00:00.000Z').has(other)
    await missing('same-person', '2026-11-21T08:00:00.000Z')
    await missing('same-person', '2026-11-21T10:00:00.000Z')
    expect(broken()).toBe(false)
    await missing('someone-else', '2026-11-21T11:00:00.000Z')
    expect(broken()).toBe(true)
  })

  it('trusts only the address our proxy added, not what the client wrote before it', async () => {
    expect(await report('ok', '203.0.113.1, 10.2.0.1')).toBe('accepted')
    expect(await report('ok', '198.51.100.7, 10.2.0.1')).toBe('duplicate')
  })

  it('takes at most 20 reports a day for one device, whoever sends them', async () => {
    const { store } = await getContext()
    const sent = store.passports.reportsOf(other).filter((entry) => entry.at.startsWith('2026-11-21')).length
    for (let index = sent; index < REPORTS_PER_DEVICE_DAY; index++) expect(await report('ok', `10.3.0.${index}`)).toBe('accepted')
    expect(await report('ok', '10.3.1.1')).toBe('limit')
  })
})

describe('public passport', () => {
  it('answers for a known device and 404 for an unknown one', async () => {
    const passport = (await (await get(`/v1/aed/${id}/passport`)).json()) as any
    expect(passport).toMatchObject({ id, passportUrl: `http://localhost:3000/aed/${id}` })
    expect((await get('/v1/aed/00000000-0000-0000-0000-000000000000/passport')).status).toBe(404)
  })

  it('sends the management link only to the address already in the data', async () => {
    const { store } = await getContext()
    const withEmail = store.aeds.find((aed) => aed.publication === 'official' && aed.record.email_kontaktowy)
    const withoutEmail = store.aeds.find((aed) => aed.publication === 'official' && !aed.record.email_kontaktowy)!
    expect((await post(`/v1/aed/${withoutEmail.id}/passport/link`, {})).status).toBe(409)
    if (withEmail) {
      const sent = (await (await post(`/v1/aed/${withEmail.id}/passport/link`, {})).json()) as any
      expect(sent.sentTo).toBe(maskEmail(withEmail.record.email_kontaktowy!))
      expect((await post(`/v1/aed/${withEmail.id}/passport/link`, {})).status).toBe(409)
    }
  })
})
