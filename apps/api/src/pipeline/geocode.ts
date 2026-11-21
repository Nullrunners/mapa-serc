/**
 * Polish state registers, both free and without a key:
 *   ULDK (uldk.gugik.gov.pl)       commune (TERC) for a point
 *   UUG  (services.gugik.gov.pl)   coordinates and TERYT codes for an address
 * Every answer is cached, so a re-run of the pipeline asks only about new records.
 */
import type { AedInput } from '@aed/schema'
import { distanceM } from './normalize'
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

export interface Geo {
  commune(lat: number, lon: number): Promise<Commune | null>
  address(query: string): Promise<GeocodedAddress | null>
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

  const text = async (url: string): Promise<string> => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'aed-hub/0.1' } })
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`)
    return response.text()
  }

  return {
    commune: (lat, lon) =>
      cached(`uldk:${lat.toFixed(5)},${lon.toFixed(5)}`, async () => {
        const body = await text(`https://uldk.gugik.gov.pl/?request=GetCommuneByXY&xy=${lon},${lat},4326&result=teryt,commune,county,voivodeship`)
        const [status, line] = body.trim().split('\n')
        if (status?.trim() !== '0' || !line) return null
        const [teryt, gmina, powiat, wojewodztwo] = line.split('|').map((part) => part.trim())
        const terc = (teryt ?? '').replace(/\D/g, '')
        if (terc.length !== 7) return null
        return { terc, gmina: gmina ?? '', powiat: powiat ?? '', wojewodztwo: wojewodztwo ?? '' }
      }),

    address: (query) =>
      cached(`uug:${query.toLowerCase()}`, async () => {
        const body = JSON.parse(await text(`https://services.gugik.gov.pl/uug/?request=GetAddress&srid=4326&address=${encodeURIComponent(query)}`)) as {
          results?: Record<string, Record<string, string>> | null
        }
        const first = body.results ? Object.values(body.results)[0] : undefined
        const lat = Number(first?.y)
        const lon = Number(first?.x)
        if (!first || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
        return { lat, lon, city: first.city ?? '', street: first.street ?? '', number: first.number ?? '', postcode: first.code ?? '', simc: first.simc ?? '' }
      }),
  }
}

/** "Marki, Wczasowa 5" – the form the address geocoder answers best. */
export function addressQuery(input: AedInput): string | null {
  if (!input.miejscowosc) return null
  const street = [input.nazwa_ulicy, input.nr_budynku].filter(Boolean).join(' ')
  return street ? `${input.miejscowosc}, ${street}` : null
}

/** "Marki (miasto)" → "Marki". */
const communeName = (gmina: string) => gmina.replace(/\s*\(.*\)\s*$/, '').trim()

const round = (value: number) => Math.round(value * 1e7) / 1e7

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
            if (!input.kod_pocztowy && found.postcode) {
              input.kod_pocztowy = found.postcode
              record.fixes.push({ code: 'postcode_from_register', field: 'kod_pocztowy', message: 'Kod pocztowy uzupełniono z państwowego rejestru adresów.', after: found.postcode })
            }
            if (!input.kod_simc && /^\d{7}$/.test(found.simc)) {
              input.kod_simc = found.simc
              record.fixes.push({ code: 'simc_from_register', field: 'kod_simc', message: 'Kod SIMC miejscowości uzupełniono z państwowego rejestru adresów.', after: found.simc })
            }
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

/** Distance between where a provider put the device and where its address is, when both are known. */
export async function addressOffsetM(input: AedInput, geo: Geo): Promise<number | null> {
  const query = addressQuery(input)
  if (!query || input.szerokosc_geograficzna == null || input.dlugosc_geograficzna == null) return null
  const found = await geo.address(query)
  return found ? distanceM(input.szerokosc_geograficzna, input.dlugosc_geograficzna, found.lat, found.lon) : null
}
