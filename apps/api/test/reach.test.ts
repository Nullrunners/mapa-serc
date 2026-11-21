/** "Dostępny TERAZ": the order of devices by how soon one is in hand, not by straight-line distance. */
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { accessMethod, floorsAway, reach, type ReachRecord } from '../src/reach/score'

const device = (fields: Partial<ReachRecord>): ReachRecord => ({
  status: 'czynny',
  dostep: 'publiczny',
  godziny_dostepnosci: null,
  wewnatrz_budynku: null,
  pietro: null,
  sposob_dostepu: null,
  uwagi_dostepu: null,
  opis_lokalizacji: 'Hol główny',
  ...fields,
})

/** Monday 23 November 2026, 19:00 in Warsaw. */
const evening = new Date('2026-11-23T19:00:00+01:00')

describe('reach', () => {
  it('puts a 24/7 device on a wall 250 m away before an office 50 m away that closed at 18:00', () => {
    const wall = reach(device({ godziny_dostepnosci: '24/7', wewnatrz_budynku: false, sposob_dostepu: 'szafka_z_alarmem' }), 250, evening)
    const office = reach(device({ godziny_dostepnosci: 'Mo-Fr 08:00-18:00', wewnatrz_budynku: true }), 50, evening, { withChange: true })
    expect(wall).toMatchObject({ state: 'open', etaS: 173, reasons: ['hours_24_7', 'method_alarm'] })
    expect(office).toMatchObject({ state: 'closed', etaS: null, change: { open: false, time: '08:00', days: 1 } })
    expect(wall.score).toBeLessThan(office.score)
  })

  it('counts the seconds lost on the spot', () => {
    const free = reach(device({ godziny_dostepnosci: '24/7', sposob_dostepu: 'swobodny' }), 100, evening)
    const code = reach(device({ godziny_dostepnosci: '24/7', sposob_dostepu: 'szafka_z_kodem' }), 100, evening)
    const upstairs = reach(device({ godziny_dostepnosci: '24/7', sposob_dostepu: 'swobodny', pietro: '2', wewnatrz_budynku: true }), 100, evening)
    expect(code.etaS! - free.etaS!).toBe(60)
    expect(upstairs.etaS! - free.etaS!).toBe(40)
    expect(upstairs.reasons).toContain('floor')
  })

  it('trusts an outdoor cabinet without hours more than an indoor device without hours, and a known open door most', () => {
    const outdoor = reach(device({ wewnatrz_budynku: false }), 100, evening)
    const indoor = reach(device({ wewnatrz_budynku: true }), 100, evening)
    const open = reach(device({ godziny_dostepnosci: '24/7', wewnatrz_budynku: true }), 100, evening)
    expect([outdoor.state, indoor.state, open.state]).toEqual(['likely_open', 'unknown', 'open'])
    expect(open.score).toBeLessThan(outdoor.score)
    expect(outdoor.score).toBeLessThan(indoor.score)
  })

  it('puts an indoor device without hours below a known open one at night, as the gap analysis assumes office hours', () => {
    const night = new Date('2026-11-22T03:00:00+01:00')
    const office = reach(device({ wewnatrz_budynku: true }), 200, night)
    const wall = reach(device({ godziny_dostepnosci: '24/7', wewnatrz_budynku: false }), 480, night)
    expect(office.reasons).toEqual(['no_hours', 'assumed_closed'])
    expect(wall.score).toBeLessThan(office.score)
    // On a working day at noon the same office is a fair bet.
    expect(reach(device({ wewnatrz_budynku: true }), 200, new Date('2026-11-23T12:00:00+01:00')).reasons).toEqual(['no_hours'])
  })

  it('moves a device with an unresolved problem report down, and leaves withdrawn and staff-only devices out of reach', () => {
    const fine = reach(device({ godziny_dostepnosci: '24/7' }), 100, evening)
    expect(reach(device({ godziny_dostepnosci: '24/7' }), 100, evening, { problem: true }).score).toBeGreaterThan(fine.score)
    expect(reach(device({ status: 'wycofany', godziny_dostepnosci: '24/7' }), 10, evening)).toMatchObject({ state: 'closed', reasons: expect.arrayContaining(['out_of_service']) })
    expect(reach(device({ dostep: 'prywatny' }), 10, evening)).toMatchObject({ state: 'closed', reasons: expect.arrayContaining(['staff_only']) })
  })

  it('guesses the access method only from phrases that leave no doubt', () => {
    expect(accessMethod(device({ opis_lokalizacji: 'Defibrylator umieszczony w portierni budynku.' }))).toEqual({ method: 'przez_obsluge', guessed: true })
    expect(accessMethod(device({ uwagi_dostepu: 'Klucze po zamknięciu obiektu dostępne na portierni.' })).method).toBe('przez_obsluge')
    expect(accessMethod(device({ opis_lokalizacji: 'Urządzenie znajduje się na parterze, przy portierni' })).method).toBeNull()
    expect(accessMethod(device({ opis_lokalizacji: 'Szafka z kodem, kod podaje dyspozytor 112' })).method).toBe('szafka_z_kodem')
    expect(accessMethod(device({ sposob_dostepu: 'swobodny', opis_lokalizacji: 'w portierni' }))).toEqual({ method: 'swobodny', guessed: false })
  })

  it('reads floors written in different ways', () => {
    expect(['0', 'parter', '-1', '2', 'I piętro', 'III', 'hol'].map(floorsAway)).toEqual([0, 0, 1, 2, 1, 3, null])
  })
})

describe('GET /v1/aed?sort=reach', () => {
  const app = createApp()

  beforeAll(async () => {
    const response = await app.request('/admin/jobs/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' }, body: '{}' })
    expect(response.status).toBe(200)
  })

  it('orders by expected time and explains each device', async () => {
    const at = encodeURIComponent('2026-11-22T03:00:00+01:00')
    const body = (await (await app.request(`/v1/aed?near=52.4010,20.9260&radiusM=3000&sort=reach&at=${at}&limit=50`)).json()) as any
    expect(body.items.length).toBeGreaterThan(5)
    const scores = body.items.map((item: any) => item.reach.score)
    expect(scores).toEqual([...scores].sort((a: number, b: number) => a - b))
    // At 3:00 on a Sunday nothing with office hours is open; closed devices come last.
    const states = body.items.map((item: any) => item.reach.state)
    expect(states.lastIndexOf('open')).toBeLessThan(Math.max(states.indexOf('closed'), states.length))
    if (states.includes('closed')) expect(states.slice(states.indexOf('closed')).every((state: string) => state === 'closed')).toBe(true)
  })

  it('still sorts by distance by default', async () => {
    const body = (await (await app.request('/v1/aed?near=52.4010,20.9260&limit=10')).json()) as any
    const distances = body.items.map((item: any) => item.distanceM)
    expect(distances).toEqual([...distances].sort((a: number, b: number) => a - b))
    expect(body.items[0].reach).toBeDefined()
  })
})
