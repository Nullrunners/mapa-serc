/** "Can I get to it right now?" from the hours in `godziny_dostepnosci`. Times below are Polish local time. */
import { describe, expect, it } from 'vitest'
import { availabilityAt, easter, isPolishHoliday, nextChange, reachableNow } from '@aed/schema'

/** 2026-11-21 is a Saturday; in November Poland is at UTC+1. */
const at = (day: number, time: string) => new Date(`2026-11-${day}T${time}:00+01:00`)
const saturday = 21
const sunday = 22
const monday = 23

describe('availabilityAt', () => {
  it('knows round-the-clock devices', () => {
    expect(availabilityAt('24/7', at(sunday, '03:00'))).toBe('open')
  })

  it('reads weekday and time ranges', () => {
    expect(availabilityAt('Mo-Fr 08:00-16:00', at(monday, '08:00'))).toBe('open')
    expect(availabilityAt('Mo-Fr 08:00-16:00', at(monday, '15:59'))).toBe('open')
    expect(availabilityAt('Mo-Fr 08:00-16:00', at(monday, '16:00'))).toBe('closed')
    expect(availabilityAt('Mo-Fr 08:00-16:00', at(saturday, '10:00'))).toBe('closed')
    expect(availabilityAt('Mo-Fr 07:30-15:30; Sa 08:00-12:00', at(saturday, '10:00'))).toBe('open')
    expect(availabilityAt('Mo,We,Fr 08:00-12:00,13:00-17:00', at(monday, '12:30'))).toBe('closed')
    expect(availabilityAt('Mo,We,Fr 08:00-12:00,13:00-17:00', at(monday, '13:00'))).toBe('open')
    expect(availabilityAt('06:00-22:00', at(sunday, '21:00'))).toBe('open')
    expect(availabilityAt('Sa-Mo 10:00-18:00', at(sunday, '11:00'))).toBe('open')
  })

  it('follows a range past midnight into the next day', () => {
    expect(availabilityAt('Fr,Sa 20:00-04:00', at(saturday, '02:00'))).toBe('open')
    expect(availabilityAt('Fr,Sa 20:00-04:00', at(sunday, '02:00'))).toBe('open')
    expect(availabilityAt('Fr,Sa 20:00-04:00', at(monday, '02:00'))).toBe('closed')
    expect(availabilityAt('Mo-Su 00:00-24:00', at(sunday, '23:59'))).toBe('open')
  })

  it('lets a later rule replace an earlier one for the days it names', () => {
    expect(availabilityAt('Mo-Su 08:00-20:00; Su off', at(sunday, '10:00'))).toBe('closed')
    expect(availabilityAt('Mo-Su 08:00-20:00; Su off', at(saturday, '10:00'))).toBe('open')
  })

  it('does not guess', () => {
    expect(availabilityAt(null, at(monday, '10:00'))).toBe('unknown')
    expect(availabilityAt('', at(monday, '10:00'))).toBe('unknown')
    expect(availabilityAt('Mo-Fr 08:00-16:00; SH off', at(monday, '10:00'))).toBe('unknown')
    expect(availabilityAt('PH off', at(monday, '10:00'))).toBe('unknown')
    expect(availabilityAt('Apr-Oct: Mo-Su 09:00-18:00', at(monday, '10:00'))).toBe('unknown')
    expect(availabilityAt('sunrise-sunset', at(monday, '10:00'))).toBe('unknown')
    expect(availabilityAt('Mo-Fr 08:00-25:00', at(monday, '10:00'))).toBe('unknown')
    expect(availabilityAt('w godzinach pracy urzędu', at(monday, '10:00'))).toBe('unknown')
  })

  it('uses Polish time in summer too', () => {
    // 2026-07-06 is a Monday; 14:30 UTC is 16:30 in Warsaw.
    expect(availabilityAt('Mo-Fr 08:00-16:00', new Date('2026-07-06T14:30:00Z'))).toBe('closed')
    expect(availabilityAt('Mo-Fr 08:00-16:00', new Date('2026-07-06T13:30:00Z'))).toBe('open')
  })
})

describe('public holidays', () => {
  it('knows the Polish calendar, Easter included', () => {
    expect(easter(2026)).toEqual([4, 5])
    expect(easter(2027)).toEqual([3, 28])
    for (const date of ['2026-04-05', '2026-04-06', '2026-05-24', '2026-06-04', '2026-11-11', '2026-12-24', '2026-12-26']) expect(isPolishHoliday(date)).toBe(true)
    for (const date of ['2026-11-12', '2024-12-24', '2026-06-05']) expect(isPolishHoliday(date)).toBe(false)
  })

  it('closes an office on a holiday that falls on a weekday', () => {
    // 2026-11-11 is a Wednesday.
    const wednesday = new Date('2026-11-11T10:00:00+01:00')
    expect(availabilityAt('Mo-Fr 08:00-16:00; PH off', wednesday)).toBe('closed')
    expect(availabilityAt('Mo-Fr 08:00-16:00; PH off', at(monday, '10:00'))).toBe('open')
    expect(availabilityAt('Mo-Fr 08:00-16:00; Sa,PH 10:00-14:00', wednesday)).toBe('open')
    expect(availabilityAt('Mo-Fr 08:00-16:00; Sa,PH 10:00-14:00', at(saturday, '13:00'))).toBe('open')
    expect(availabilityAt('Mo-Fr 08:00-16:00', wednesday)).toBe('open')
  })
})

describe('nextChange', () => {
  it('tells when an open device closes and a closed one opens', () => {
    expect(nextChange('Mo-Fr 08:00-18:00', at(monday, '14:03'))).toEqual({ open: true, minutes: 237, time: '18:00', days: 0 })
    expect(nextChange('Mo-Fr 08:00-18:00', at(saturday, '10:00'))).toMatchObject({ open: false, time: '08:00', days: 2 })
    // Tuesday 10 November, 17:00: the next day is a holiday, so the office opens on Thursday.
    expect(nextChange('Mo-Fr 08:00-16:00; PH off', new Date('2026-11-10T17:00:00+01:00'))).toMatchObject({ open: false, time: '08:00', days: 2 })
    expect(nextChange('24/7', at(monday, '10:00'))).toBeNull()
    expect(nextChange('sunrise-sunset', at(monday, '10:00'))).toBeNull()
  })
})

describe('reachableNow', () => {
  const device = { status: 'czynny', dostep: 'publiczny', godziny_dostepnosci: '24/7' } as const

  it('says yes only when the hours cover the moment', () => {
    expect(reachableNow(device, at(sunday, '03:00'))).toBe('yes')
    expect(reachableNow({ ...device, godziny_dostepnosci: 'Mo-Fr 08:00-16:00' }, at(sunday, '03:00'))).toBe('no')
    expect(reachableNow({ ...device, godziny_dostepnosci: null }, at(sunday, '03:00'))).toBe('unknown')
    expect(reachableNow({ ...device, dostep: null, status: 'nieznany' }, at(sunday, '03:00'))).toBe('yes')
  })

  it('says no for a device that is withdrawn, out of service or for staff only', () => {
    expect(reachableNow({ ...device, status: 'wycofany' }, at(monday, '10:00'))).toBe('no')
    expect(reachableNow({ ...device, status: 'czasowo_niedostepny' }, at(monday, '10:00'))).toBe('no')
    expect(reachableNow({ ...device, dostep: 'prywatny' }, at(monday, '10:00'))).toBe('no')
  })
})
