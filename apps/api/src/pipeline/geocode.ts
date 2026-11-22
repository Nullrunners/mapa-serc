/**
 * Polish state registers, both free and without a key:
 *   ULDK (uldk.gugik.gov.pl)       commune (TERC) for a point
 *   UUG  (services.gugik.gov.pl)   coordinates and TERYT codes for an address, and the address nearest to a point
 * Every answer is cached, so a re-run of the pipeline asks only about new records.
 */
import type { AedInput } from '@aed/schema'
import { distanceM, splitStreet } from './normalize'
import type { NormalizedRecord } from './types'

export interface Commune {
  /** Seven-digit TERC, including the commune-type digit. */
  terc: string
  gmina: string
  powiat: string
  wojewodztwo: string
}

export interface GeocodedAddress {
  lat: number
  lon: number
  city: string
  street: string
  number: string
  postcode: string
  simc: string
}

export interface GeoCache {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>
}

/** A town or village the address register knows by name, with the commune it lies in. */
export interface Locality {
  name: string
  gmina: string
  powiat: string
  wojewodztwo: string
  lat: number
  lon: number
}

export interface Geo {
  commune(lat: number, lon: number): Promise<Commune | null>
  /**
   * The commune at a point with its boundary as WKT (WGS84), or null when no commune is there (the sea, abroad).
   * Not cached: the boundary is large, so the caller keeps a simplified copy. Throws when the register does not answer.
   */
  communeBoundary(lat: number, lon: number): Promise<{ commune: Commune; wkt: string } | null>
  /** Towns and villages of this name, at most ten. Throws when the register refuses, so a refusal is not remembered. */
  localities(name: string): Promise<Locality[]>
  address(query: string): Promise<GeocodedAddress | null>
  /** The address point closest to a position, if there is one within 100 m. */
  nearestAddress(lat: number, lon: number): Promise<GeocodedAddress | null>
}

/** "140801_1|Legionowo (miasto)|powiat legionowski|mazowieckie" → a commune; null when the TERC is not seven digits. */
function communeOf([teryt, gmina, powiat, wojewodztwo]: (string | undefined)[]): Commune | null {
  const terc = (teryt ?? '').trim().replace(/\D/g, '')
  if (terc.length !== 7) return null
  return { terc, gmina: gmina?.trim() ?? '', powiat: powiat?.trim() ?? '', wojewodztwo: wojewodztwo?.trim() ?? '' }
}

export const memoryCache = (): GeoCache => {
  const map = new Map<string, unknown>()
  return { get: async (key) => map.get(key), set: async (key, value) => void map.set(key, value) }
}

/** At most `limit` requests in flight: the registers are public services, not ours to flood. */
function limiter(limit: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve))
    active++
    try {
      return await work()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

export function createGeo(cache: GeoCache, fetchImpl: typeof fetch = fetch): Geo {
  const limit = limiter(4)

  async function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = await cache.get(key)
    if (hit !== undefined) return hit as T | null
    const value = await limit(load)
    await cache.set(key, value)
    return value
  }

  const text = async (url: string, timeoutMs = 15_000): Promise<string> => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'aed-hub/0.1' } })
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`)
    return response.text()
  }

  /**
   * ULDK turns away a client it finds too eager with a redirect to an endless stream of filler (about 150 MB).
   * Take the redirect itself as the refusal, so nothing is downloaded and nothing wrong is cached.
   */
  const uldk = async (url: string, timeoutMs = 15_000): Promise<string> => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual', headers: { 'User-Agent': 'aed-hub/0.1' } })
    if (response.status !== 200) throw new Error(`HTTP ${response.status} from ULDK`)
    return response.text()
  }

  /** First result of the address register. A village without street names comes back with no street. */
  const uug = async (query: string): Promise<GeocodedAddress | null> => {
    const body = JSON.parse(await text(`https://services.gugik.gov.pl/uug/?${query}`)) as { notice?: string; results?: Record<string, Record<string, string | null>> | null }
    // "blocked for abuse" and the like come without a results field: a refusal, not "no address here", so it must
    // not be remembered (the cache keeps whatever this returns).
    if (!('results' in body)) throw new Error(`UUG refused: ${body.notice ?? 'no results field'}`)
    const first = body.results ? Object.values(body.results)[0] : undefined
    const lat = Number(first?.y)
    const lon = Number(first?.x)
    if (!first || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat, lon, city: first.city ?? '', street: first.street ?? '', number: first.number ?? '', postcode: first.code ?? '', simc: first.simc ?? '' }
  }

  return {
    commune: (lat, lon) =>
      cached(`uldk:${lat.toFixed(5)},${lon.toFixed(5)}`, async () => {
        const body = await uldk(`https://uldk.gugik.gov.pl/?request=GetCommuneByXY&xy=${lon},${lat},4326&result=teryt,commune,county,voivodeship`)
        const [status, line] = body.trim().split('\n')
        if (status?.trim() !== '0' || !line) return null
        return communeOf(line.split('|'))
      }),

    communeBoundary: async (lat, lon) => {
      const url = `https://uldk.gugik.gov.pl/?request=GetCommuneByXY&xy=${lon},${lat},4326&result=teryt,commune,county,voivodeship,geom_wkt&srid=4326`
      // The register now and then refuses or sends half an answer; asking again a moment later often helps.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((done) => setTimeout(done, 400 * attempt))
        const body = await limit(() => uldk(url, 4000)).catch(() => null)
        if (body === null) continue
        const [status = '', ...lines] = body.trim().split('\n')
        // "-1 brak wyników": no commune at this point.
        if (status.trim().startsWith('-1')) return null
        const parts = lines.join('').trim().split('|')
        const commune = status.trim() === '0' && parts.length === 5 && parts[4]!.startsWith('SRID=4326;') ? communeOf(parts) : null
        if (commune) return { commune, wkt: parts[4]! }
      }
      throw new Error('ULDK did not send the commune boundary')
    },

    localities: async (name) => {
      const key = `uug-towns:${name.toLowerCase()}`
      const hit = await cache.get(key)
      if (hit !== undefined) return hit as Locality[]
      const body = JSON.parse(await limit(() => text(`https://services.gugik.gov.pl/uug/?request=GetAddress&srid=4326&address=${encodeURIComponent(name)}`))) as {
        notice?: string
        results?: Record<string, Record<string, string | null>> | null
      }
      // "blocked for abuse" and the like: no answer, so nothing to remember.
      if (!('results' in body)) throw new Error(`UUG refused: ${body.notice ?? 'no results field'}`)
      const found = Object.values(body.results ?? {})
        .map((result) => ({ name: result.city ?? '', gmina: result.commune ?? '', powiat: result.county ?? '', wojewodztwo: result.voivodeship ?? '', lat: Number(result.y), lon: Number(result.x) }))
        .filter((locality) => locality.name && Number.isFinite(locality.lat) && Number.isFinite(locality.lon))
        .slice(0, 10)
      await cache.set(key, found)
      return found
    },

    address: (query) => cached(`uug:${query.toLowerCase()}`, () => uug(`request=GetAddress&srid=4326&address=${encodeURIComponent(query)}`)),

    nearestAddress: (lat, lon) =>
      cached(`uug-point:${lat.toFixed(5)},${lon.toFixed(5)}`, () => uug(`request=GetAddressReverse&srid=4326&location=${encodeURIComponent(`POINT(${lon} ${lat})`)}`)),
  }
}

/** "Marki, Wczasowa 5" – the form the address geocoder answers best. */
export function addressQuery(input: AedInput): string | null {
  if (!input.miejscowosc) return null
  const street = [input.nazwa_ulicy, input.nr_budynku].filter(Boolean).join(' ')
  return street ? `${input.miejscowosc}, ${street}` : null
}

/** "Marki (miasto)" → "Marki". */
export const communeName = (gmina: string) => gmina.replace(/\s*\(.*\)\s*$/, '').trim()

const round = (value: number) => Math.round(value * 1e7) / 1e7

/** Postcode and locality code of an address the register knows, where the record has none. */
function completeCodes(record: NormalizedRecord, found: GeocodedAddress): void {
  const { input } = record
  if (!input.kod_pocztowy && found.postcode) {
    input.kod_pocztowy = found.postcode
    record.fixes.push({ code: 'postcode_from_register', field: 'kod_pocztowy', message: 'Kod pocztowy uzupełniono z państwowego rejestru adresów.', after: found.postcode })
  }
  if (!input.kod_simc && /^\d{7}$/.test(found.simc)) {
    input.kod_simc = found.simc
    record.fixes.push({ code: 'simc_from_register', field: 'kod_simc', message: 'Kod SIMC miejscowości uzupełniono z państwowego rejestru adresów.', after: found.simc })
  }
}

/**
 * Completes records from the registers:
 *  1. no usable coordinates → geocode the address;
 *  2. commune code (TERC) from the coordinates; a declared code that disagrees with the point is reported;
 *  3. locality from the commune name when the source gave none (OSM).
 * A register that does not answer leaves the record as it was: the next run tries again.
 */
export async function enrich(records: NormalizedRecord[], geo: Geo, options: { geocodeAddresses: boolean } = { geocodeAddresses: true }): Promise<void> {
  await Promise.all(
    records.map(async (record) => {
      const { input } = record
      try {
        if (input.szerokosc_geograficzna == null && options.geocodeAddresses) {
          const query = addressQuery(input)
          const found = query ? await geo.address(query) : null
          if (found) {
            input.szerokosc_geograficzna = round(found.lat)
            input.dlugosc_geograficzna = round(found.lon)
            completeCodes(record, found)
            record.fixes.push({
              code: 'geocoded_from_address',
              field: 'szerokosc_geograficzna',
              message: `Położenie ustalono z adresu (${query}) w państwowym rejestrze adresów.`,
              after: `${input.szerokosc_geograficzna}; ${input.dlugosc_geograficzna}`,
            })
          }
        }
        if (input.szerokosc_geograficzna == null || input.dlugosc_geograficzna == null) return

        const commune = await geo.commune(input.szerokosc_geograficzna, input.dlugosc_geograficzna)
        if (!commune) return
        if (input.kod_terc && input.kod_terc !== commune.terc) {
          record.issues.push({
            code: 'address_point_mismatch',
            severity: 'warning',
            field: 'kod_terc',
            message: `Punkt leży w gminie ${communeName(commune.gmina)} (${commune.terc}), a dostawca podał gminę ${input.kod_terc}. Przyjęto gminę wynikającą z położenia.`,
          })
        }
        if (input.kod_terc !== commune.terc) {
          record.fixes.push({ code: 'terc_from_coordinates', field: 'kod_terc', message: 'Kod TERC gminy ustalono z położenia.', before: input.kod_terc ?? undefined, after: commune.terc })
          input.kod_terc = commune.terc
        }
        if (!input.miejscowosc) {
          input.miejscowosc = communeName(commune.gmina)
          record.fixes.push({ code: 'locality_from_commune', field: 'miejscowosc', message: 'Miejscowość przyjęto z nazwy gminy, w której leży punkt.', after: input.miejscowosc })
        }
      } catch {
        // Offline or the register is down: keep what the source gave us.
      }
    }),
  )
}

/**
 * Gives records that have a position but no street address the nearest address point of the register.
 * OpenStreetMap hardly ever carries an address, and a device in a place nobody named has nothing else to go by.
 * Run it after duplicates are matched: an address read off the position is not a second piece of evidence that
 * two records describe the same device. A point the register (or its cache) has no answer for stays as it was.
 */
export async function addressFromPoint(records: NormalizedRecord[], geo: Geo): Promise<void> {
  await Promise.all(
    records.map(async (record) => {
      const { input } = record
      if (input.szerokosc_geograficzna == null || input.dlugosc_geograficzna == null || input.nazwa_ulicy || input.nr_budynku) return
      const found = await geo.nearestAddress(input.szerokosc_geograficzna, input.dlugosc_geograficzna).catch(() => null)
      if (!found?.number) return

      // The commune's name stood in for the locality (see `enrich`); the address point knows the actual town or village.
      const guess = record.fixes.findIndex((fix) => fix.code === 'locality_from_commune')
      if (found.city && (guess >= 0 || !input.miejscowosc)) {
        if (guess >= 0) record.fixes.splice(guess, 1)
        input.miejscowosc = found.city
        record.fixes.push({ code: 'locality_from_register', field: 'miejscowosc', message: 'Miejscowość przyjęto z punktu adresowego najbliżej urządzenia.', after: found.city })
      }
      // An address in another locality than the one the source named would contradict it; leave such a record alone.
      if (found.city && input.miejscowosc !== found.city) return

      Object.assign(input, found.street ? splitStreet(`${found.street} ${found.number}`) : { nr_budynku: found.number })
      record.fixes.push({
        code: 'address_from_coordinates',
        field: 'nazwa_ulicy',
        message: 'Adres ustalono z położenia: to najbliższy punkt adresowy w państwowym rejestrze adresów.',
        after: [[found.street, found.number].filter(Boolean).join(' '), found.city].filter(Boolean).join(', '),
      })
      completeCodes(record, found)
    }),
  )
}

/** Distance between where a provider put the device and where its address is, when both are known. */
export async function addressOffsetM(input: AedInput, geo: Geo): Promise<number | null> {
  const query = addressQuery(input)
  if (!query || input.szerokosc_geograficzna == null || input.dlugosc_geograficzna == null) return null
  const found = await geo.address(query)
  return found ? distanceM(input.szerokosc_geograficzna, input.dlugosc_geograficzna, found.lat, found.lon) : null
}
