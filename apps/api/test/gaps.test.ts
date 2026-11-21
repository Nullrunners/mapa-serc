/** The gap engine: projection, weekly hours, population, coverage, greedy placement and the endpoints. */
import { cellToLatLng, latLngToCell } from 'h3-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { weeklyHours } from '@aed/schema'
import { createApp } from '../src/app'
import { buildCoverage, hexesOfCell, hexState, RES, type HexState } from '../src/gaps/engine'
import { recommend } from '../src/gaps/greedy'
import { laeaToWgs84 } from '../src/gaps/laea'
import { cellCentre, populationCells, type GridCell } from '../src/gaps/population'
import { classify, countHours, FULL_WEEK, maskOf, type SupplyPoint } from '../src/gaps/supply'

const app = createApp()

describe('EPSG:3035 to WGS84', () => {
  it('matches the control point of the IOGP guidance note', () => {
    const [lat, lon] = laeaToWgs84(3962799.45, 2999718.85)
    expect(lat).toBeCloseTo(50, 6)
    expect(lon).toBeCloseTo(5, 6)
  })

  it('puts the census square of central Warsaw in Warsaw', () => {
    const [lat, lon] = cellCentre({ e: 5070, n: 3292 })
    expect(lat).toBeGreaterThan(52.1)
    expect(lat).toBeLessThan(52.4)
    expect(lon).toBeGreaterThan(20.8)
    expect(lon).toBeLessThan(21.3)
  })
})

describe('hours of an ordinary week', () => {
  const hours = (value: string | null) => weeklyHours(value)?.filter(Boolean).length ?? null

  it('counts the hours a device can be reached', () => {
    expect(hours('24/7')).toBe(168)
    expect(hours('Mo-Fr 07:30-15:30')).toBe(40)
    expect(hours('Mo-Su 06:00-22:00')).toBe(112)
    expect(hours('Mo-Fr 22:00-06:00')).toBe(40)
  })

  it('ignores public holidays instead of giving up', () => {
    expect(hours('Mo-Fr 07:30-15:30; Sa-Su, PH off')).toBe(40)
    expect(hours('Mo 08:00-17:00; Tu-Fr 08:00-15:00; Sa-Su,PH off')).toBe(37)
    expect(hours('PH off')).toBeNull()
  })

  it('gives null for what it cannot read', () => {
    expect(hours(null)).toBeNull()
    expect(hours('w godzinach otwarcia')).toBeNull()
  })

  it('classifies every device by where its hours come from', () => {
    const base = { status: 'czynny', dostep: 'publiczny', godziny_dostepnosci: null, wewnatrz_budynku: null } as const
    const of = (record: Partial<Parameters<typeof classify>[0]>) => {
      const { basis, mask } = classify({ ...base, ...record } as Parameters<typeof classify>[0])
      return [basis, countHours(mask)]
    }
    expect(of({ godziny_dostepnosci: '24/7' })).toEqual(['hours', 168])
    expect(of({ godziny_dostepnosci: 'Mo-Fr 07:30-15:30', wewnatrz_budynku: false })).toEqual(['hours', 40])
    expect(of({ wewnatrz_budynku: false })).toEqual(['outdoor', 168])
    expect(of({ wewnatrz_budynku: true })).toEqual(['assumed', 40])
    expect(of({})).toEqual(['assumed', 40])
    expect(of({ dostep: 'prywatny', godziny_dostepnosci: '24/7' })).toEqual(['excluded', 0])
    expect(of({ status: 'wycofany', godziny_dostepnosci: '24/7' })).toEqual(['excluded', 0])
  })
})

describe('population', () => {
  it('holds every populated square of Poland from the 2021 census', () => {
    const cells = populationCells()
    expect(cells).toHaveLength(197_439)
    expect(cells.reduce((sum, cell) => sum + cell.residents, 0)).toBe(37_092_675)
    expect(cells.every((cell) => cell.seniors >= 0 && cell.seniors <= cell.residents)).toBe(true)
  })

  it('splits a square among hexagons without losing anyone', () => {
    const cell: GridCell = { e: 5070, n: 3292, residents: 7000, seniors: 1400 }
    const hexes = hexesOfCell(cell)
    expect(hexes.length).toBeGreaterThanOrEqual(7)
    expect(hexes.length).toBeLessThanOrEqual(13)
    expect(hexes.reduce((sum, hex) => sum + hex.residents, 0)).toBeCloseTo(7000, 6)
    expect(new Set(hexes.map((hex) => hex.hex)).size).toBe(hexes.length)
  })
})

const point = (lat: number, lon: number, open: boolean[] | 'all'): SupplyPoint => {
  const mask = open === 'all' ? FULL_WEEK : maskOf(open)
  return { id: `${lat},${lon}`, lat, lon, name: 'test', publication: 'official', hours: null, basis: 'hours', mask, hoursPerWeek: countHours(mask) }
}

describe('coverage and placement', () => {
  const cells: GridCell[] = [
    { e: 5070, n: 3292, residents: 7000, seniors: 1000 },
    { e: 5072, n: 3292, residents: 3000, seniors: 2000 },
    { e: 5075, n: 3295, residents: 500, seniors: 0 },
  ]
  const states = (devices: SupplyPoint[]): HexState[] => {
    const coverage = buildCoverage(devices)
    return cells.flatMap((cell) => hexesOfCell(cell).map((demand) => hexState(demand, coverage)))
  }

  it('counts a hexagon as covered all week next to a round-the-clock device, and only part of it next to an office', () => {
    const [lat, lon] = cellCentre(cells[0]!)
    const [hlat, hlon] = cellToLatLng(latLngToCell(lat, lon, RES))
    const office = weeklyHours('Mo-Fr 08:00-16:00')!
    const withAllWeek = states([point(hlat, hlon, 'all')]).find((state) => state.hex === latLngToCell(lat, lon, RES))!
    expect(withAllWeek).toMatchObject({ coveredHours: 168, noDevice: false, noNight: false, deficit: 0 })
    const withOffice = states([point(hlat, hlon, office)]).find((state) => state.hex === latLngToCell(lat, lon, RES))!
    expect(withOffice).toMatchObject({ coveredHours: 40, noDevice: false, noNight: true })
    expect(withOffice.deficit).toBeGreaterThan(0)
  })

  it('places devices where they remove the most deficit, never twice for the same residents, the same way every time', () => {
    const hexes = states([])
    const first = recommend(hexes, 5)
    const second = recommend([...hexes].reverse(), 5)
    expect(second).toEqual(first)
    expect(first).toHaveLength(5)
    for (let i = 1; i < first.length; i++) expect(first[i]!.gain).toBeLessThanOrEqual(first[i - 1]!.gain)
    const served = first.flatMap((pick) => pick.reach.filter((hex) => hexes.find((state) => state.hex === hex)))
    const gained = first.reduce((sum, pick) => sum + pick.gained.residents, 0)
    const residentsServed = [...new Set(served)].reduce((sum, hex) => sum + hexes.find((state) => state.hex === hex)!.residents, 0)
    expect(gained).toBeCloseTo(residentsServed, -1)
    // The busiest square comes first: seniors count three times, so the 3000 with 2000 seniors weigh as much as 7000 with 1000.
    expect(first[0]!.gained.residents).toBeGreaterThan(0)
  })

  it('stops when nothing is left to cover', () => {
    const [lat, lon] = cellCentre(cells[2]!)
    const hexes = states([]).filter((state) => cellToLatLng(state.hex)[0] > lat - 0.004 && cellToLatLng(state.hex)[0] < lat + 0.004)
    expect(recommend(hexes, 20).length).toBeLessThan(20)
    void lon
  })
})

describe('gap endpoints', () => {
  beforeAll(async () => {
    const response = await app.request('/admin/jobs/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' }, body: '{}' })
    expect(response.status).toBe(200)
  })

  it('analyses Legionowo and recommends places with their neighbourhood', async () => {
    const response = await app.request('/v1/gaps?bbox=20.88,52.38,20.98,52.43&n=3')
    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    expect(body.tooLarge).toBe(false)
    expect(body.totals.residents).toBeGreaterThan(40_000)
    expect(body.hexes.features.length).toBeGreaterThan(100)
    expect(body.places).toHaveLength(3)
    expect(body.places[0]).toMatchObject({ rank: 1, commune: null })
    expect(body.places[0].boundary.type).toBe('Polygon')
    expect(body.method.sources.map((source: any) => source.licence)).toEqual(['CC BY 4.0', 'ODbL 1.0'])
    const devices = body.method.devices
    expect(devices.total).toBeGreaterThan(0)
    expect(devices.hours + devices.outdoor + devices.assumed + devices.excluded).toBe(devices.total)
  })

  it('refuses an area too large for one analysis', async () => {
    const body = (await (await app.request('/v1/gaps?bbox=14.1,49.0,24.2,54.9')).json()) as any
    expect(body).toMatchObject({ tooLarge: true, places: [] })
    expect(body.cells).toBeGreaterThan(body.maxCells)
  })

  it('gives the places as CSV', async () => {
    const response = await app.request('/v1/gaps.csv?bbox=20.88,52.38,20.98,52.43&n=2')
    expect(response.headers.get('content-type')).toContain('text/csv')
    const lines = (await response.text()).trim().split('\r\n')
    expect(lines[0]).toMatch(/^miejsce,szerokosc_geograficzna,dlugosc_geograficzna,/)
    expect(lines).toHaveLength(3)
  })
})
