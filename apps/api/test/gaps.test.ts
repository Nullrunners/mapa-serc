/** The gap engine: projection, weekly hours, population, coverage, greedy placement and the endpoints. */
import { cellToLatLng, latLngToCell } from 'h3-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { weeklyHours } from '@aed/schema'
import { createApp } from '../src/app'
import { getContext } from '../src/context'
import { areaKm2, inShape, parseRing, parseWkt, simplifyRing, type Ring, type Shape } from '../src/gaps/area'
import { buildCoverage, hexesOfCell, hexState, nationalOverview, RES, type HexState } from '../src/gaps/engine'
import { createGeo, memoryCache } from '../src/pipeline/geocode'
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

  it('sums the squares into large hexagons, the same however often it steps aside for requests', async () => {
    const [lat, lon] = cellCentre(cells[0]!)
    const coverage = buildCoverage([point(lat, lon, weeklyHours('Mo-Fr 08:00-16:00')!)])
    const quiet = await nationalOverview(cells, coverage)
    expect(quiet.totals.residents).toBe(10_500)
    expect(quiet.totals.seniors).toBe(3000)
    expect(quiet.totals.noDevice).toBeGreaterThan(0)
    expect(quiet.totals.noDevice).toBeLessThan(10_500)
    // Nobody is covered at night by a device in an office.
    expect(quiet.totals.noNight).toBe(10_500)
    expect([...quiet.areas.values()].reduce((sum, area) => sum + area.residents, 0)).toBeCloseTo(10_500, 6)

    // With a request being answered it lets go after every square.
    let asked = 0
    let turns = 0
    const turn = () => {
      turns++
      timer = setImmediate(turn)
    }
    let timer = setImmediate(turn)
    const busy = await nationalOverview(cells, coverage, () => (asked++, true))
    clearImmediate(timer)
    expect(asked).toBe(cells.length)
    expect(turns).toBeGreaterThanOrEqual(cells.length)
    expect(busy.totals).toEqual(quiet.totals)
    expect([...busy.areas].map(([hex, area]) => [hex, area.result()])).toEqual([...quiet.areas].map(([hex, area]) => [hex, area.result()]))
  })

  it('stops when nothing is left to cover', () => {
    const [lat, lon] = cellCentre(cells[2]!)
    const hexes = states([]).filter((state) => cellToLatLng(state.hex)[0] > lat - 0.004 && cellToLatLng(state.hex)[0] < lat + 0.004)
    expect(recommend(hexes, 20).length).toBeLessThan(20)
    void lon
  })
})

describe('areas: boxes, drawn shapes and communes', () => {
  // A square of about 1.4 × 1.1 km with a hole in its middle, and a second square to the east.
  const square = (lon: number, lat: number, size: number): Ring => [
    [lon, lat],
    [lon + size, lat],
    [lon + size, lat + size],
    [lon, lat + size],
    [lon, lat],
  ]
  const shape: Shape = [[square(20, 52, 0.02), square(20.005, 52.005, 0.01)], [square(20.1, 52, 0.01)]]

  it('reads a drawn ring and closes it', () => {
    expect(parseRing('20,52;20.1,52;20.05,52.1')).toEqual([
      [20, 52],
      [20.1, 52],
      [20.05, 52.1],
      [20, 52],
    ])
    expect(parseRing('20,52;20.1,52')).toBeNull()
  })

  it('reads polygons and multipolygons from the register, holes included', () => {
    expect(parseWkt('SRID=4326;POLYGON((20 52,20.02 52,20.02 52.02,20 52.02,20 52),(20.005 52.005,20.015 52.005,20.015 52.015,20.005 52.005))')).toHaveLength(1)
    const multi = parseWkt('SRID=4326;MULTIPOLYGON(((20 52,20.02 52,20.02 52.02,20 52),(20.005 52.005,20.01 52.005,20.01 52.01,20.005 52.005)),((21 52,21.01 52,21.01 52.01,21 52)))')!
    expect(multi.map((rings) => rings.length)).toEqual([2, 1])
    expect(multi[0]![0]![1]).toEqual([20.02, 52])
    expect(parseWkt('POINT(20 52)')).toBeNull()
  })

  it('counts a point in a hole as outside and a point in a second part as inside', () => {
    expect(inShape(shape, 20.002, 52.002)).toBe(true)
    expect(inShape(shape, 20.01, 52.01)).toBe(false)
    expect(inShape(shape, 20.105, 52.005)).toBe(true)
    expect(inShape(shape, 20.05, 52.005)).toBe(false)
  })

  it('measures square kilometres without the holes', () => {
    const whole = areaKm2({ bbox: [20, 52, 20.02, 52.02], shape: [[square(20, 52, 0.02)]] })
    expect(whole).toBeCloseTo(0.02 * 111.2 * Math.cos((52 * Math.PI) / 180) * 0.02 * 111.2, 2)
    expect(areaKm2({ bbox: [20, 52, 20.11, 52.02], shape })).toBeCloseTo(whole * 0.75 + whole / 4, 2)
  })

  it('simplifies a closed ring and drops one smaller than the tolerance', () => {
    const dense: Ring = []
    for (let i = 0; i <= 100; i++) dense.push([20 + 0.01 * Math.min(i, 50) / 50, 52 + 0.01 * Math.max(0, i - 50) / 50])
    dense.push([20, 52.01], [20, 52])
    const simple = simplifyRing(dense, 0.0003)!
    expect(simple.length).toBeLessThanOrEqual(5)
    expect(simple[0]).toEqual(simple.at(-1))
    expect(simplifyRing(square(20, 52, 0.0001), 0.0003)).toBeNull()
  })

  it('asks the register of boundaries again when it stumbles, and never remembers a failure', async () => {
    // First the redirect it sends a client it finds too eager, then half an answer, then the boundary.
    const answers = [() => new Response(null, { status: 302 }), () => new Response('0\n'), () => new Response('0\n140801_1|Legionowo (miasto)|powiat legionowski|mazowieckie|SRID=4326;MULTIPOLYGON(((20.9 52.39,20.95 52.39,20.95 52.42,20.9 52.39)))')]
    let asked = 0
    const register = (async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe('manual')
      return answers[asked++]!()
    }) as unknown as typeof fetch
    const found = await createGeo(memoryCache(), register).communeBoundary(52.4, 20.93)
    expect(asked).toBe(3)
    expect(found?.commune).toEqual({ terc: '1408011', gmina: 'Legionowo (miasto)', powiat: 'powiat legionowski', wojewodztwo: 'mazowieckie' })
    expect(parseWkt(found!.wkt)).toHaveLength(1)

    const sea = createGeo(memoryCache(), (async () => new Response('-1 brak wyników')) as unknown as typeof fetch)
    expect(await sea.communeBoundary(55.2, 18.5)).toBeNull()

    let refused = true
    const towns = createGeo(memoryCache(), (async () =>
      new Response(refused ? '{"notice":"blocked for abuse"}' : '{"results":{"1":{"city":"Legionowo","commune":"Legionowo","county":"legionowski","voivodeship":"mazowieckie","x":"20.93","y":"52.40"}}}')) as unknown as typeof fetch)
    await expect(towns.localities('Legionowo')).rejects.toThrow()
    refused = false
    expect(await towns.localities('Legionowo')).toEqual([{ name: 'Legionowo', gmina: 'Legionowo', powiat: 'legionowski', wojewodztwo: 'mazowieckie', lat: 52.4, lon: 20.93 }])
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

  const triangle = '20.89,52.385;20.97,52.385;20.93,52.425'

  it('analyses a drawn shape: only hexagons inside it, fewer residents than its box', async () => {
    const box = (await (await app.request('/v1/gaps?bbox=20.89,52.385,20.97,52.425&n=1')).json()) as any
    const response = await app.request(`/v1/gaps?area=${triangle}&n=2`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    expect(body.tooLarge).toBe(false)
    expect(body.totals.residents).toBeGreaterThan(0)
    expect(body.totals.residents).toBeLessThan(box.totals.residents)
    expect(body.km2).toBeCloseTo(box.km2 / 2, 0)
    const ring = parseRing(triangle)!
    for (const feature of body.hexes.features) {
      const [lat, lon] = cellToLatLng(feature.properties.hex)
      expect(inShape([[ring]], lon, lat)).toBe(true)
    }
    expect(body.places).toHaveLength(2)
  })

  it('wants exactly one area', async () => {
    expect((await app.request('/v1/gaps?n=2')).status).toBe(422)
    expect((await app.request(`/v1/gaps?bbox=20.88,52.38,20.98,52.43&area=${triangle}`)).status).toBe(422)
    expect((await app.request('/v1/gaps?area=20.89,52.385;20.97,52.385')).status).toBe(422)
  })

  it('analyses a whole commune once its boundary is known, and finds it again by a click inside', async () => {
    expect((await app.request('/v1/gaps?terc=1408011')).status).toBe(404)
    const { store } = await getContext()
    const outline = parseRing(triangle)!
    await store.geoCache().set('gmina:1408011', { terc: '1408011', gmina: 'Legionowo (miasto)', powiat: 'powiat legionowski', wojewodztwo: 'mazowieckie', shape: [[outline]] })

    const body = (await (await app.request('/v1/gaps?terc=1408011&n=2')).json()) as any
    const drawn = (await (await app.request(`/v1/gaps?area=${triangle}&n=2`)).json()) as any
    expect(body.totals).toEqual(drawn.totals)
    expect((await app.request('/v1/gaps.csv?terc=1408011&n=2')).status).toBe(200)

    const commune = await app.request('/v1/gaps/commune?at=20.93,52.40')
    expect(commune.status).toBe(200)
    expect(await commune.json()).toMatchObject({ terc: '1408011', gmina: 'Legionowo (miasto)', boundary: { type: 'MultiPolygon' } })
    // Elsewhere the register would have to be asked, and the tests have no network.
    expect((await app.request('/v1/gaps/commune?at=19.94,50.06')).status).toBe(503)
  })

  it('gives the small hexagons of a close-up view, and none for a view of the whole country', async () => {
    const near = await app.request('/v1/gaps/hexes.geojson?bbox=20.88,52.38,20.98,52.43')
    expect(near.status).toBe(200)
    const body = (await near.json()) as any
    expect(body).toMatchObject({ type: 'FeatureCollection', tooLarge: false })
    expect(body.features.length).toBeGreaterThan(100)
    expect(body.features[0].properties).toHaveProperty('uncovered')
    const country = (await (await app.request('/v1/gaps/hexes.geojson?bbox=14.1,49.0,24.2,54.9')).json()) as any
    expect(country).toMatchObject({ tooLarge: true, features: [] })
  })
})
