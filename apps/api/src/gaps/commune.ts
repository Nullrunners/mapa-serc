/**
 * Whole communes as areas to analyse. The boundary comes from the state register (ULDK) once, simplified to about
 * 30 m (a hexagon is 350 m across), and is kept in the register cache, so the analysis and its CSV, asked for by TERC,
 * never wait for the register, also after a restart.
 */
import type { Store } from '../db/store'
import { ApiError } from '../http/errors'
import type { Commune, Geo, Locality } from '../pipeline/geocode'
import { inShape, parseWkt, shapeArea, simplifyShape, type Area, type Shape } from './area'

export interface CommuneArea extends Commune {
  area: Area & { shape: Shape }
}

/** About 30 m in Poland. */
const TOLERANCE = 0.0003
const cacheKey = (terc: string) => `gmina:${terc}`

type Kept = Commune & { shape: Shape }

/** Communes looked up by this process, to answer the next click in one of them without asking the register. */
const known = new Map<string, Kept>()

const withArea = (kept: Kept): CommuneArea => ({ terc: kept.terc, gmina: kept.gmina, powiat: kept.powiat, wojewodztwo: kept.wojewodztwo, area: { ...shapeArea(kept.shape), shape: kept.shape } })

const unavailable = () => new ApiError(503, 'unavailable', 'Państwowy rejestr granic gmin nie odpowiada. Spróbuj za chwilę albo zaznacz obszar prostokątem.')

export async function communeAt(store: Store, geo: Geo, lat: number, lon: number): Promise<CommuneArea> {
  for (const kept of known.values()) if (inShape(kept.shape, lon, lat)) return withArea(kept)
  const found = await geo.communeBoundary(lat, lon).catch(() => {
    throw unavailable()
  })
  if (!found) throw new ApiError(404, 'not_found', 'W tym miejscu nie ma polskiej gminy. Kliknij na mapie w granicach Polski.')
  const shape = parseWkt(found.wkt)
  if (!shape) throw unavailable()
  const kept: Kept = { ...found.commune, shape: simplifyShape(shape, TOLERANCE) }
  known.set(kept.terc, kept)
  await store.geoCache().set(cacheKey(kept.terc), kept)
  return withArea(kept)
}

export async function communeByTerc(store: Store, terc: string): Promise<CommuneArea> {
  const kept = known.get(terc) ?? ((await store.geoCache().get(cacheKey(terc))) as Kept | undefined)
  if (!kept) throw new ApiError(404, 'not_found', 'Nie znamy jeszcze granic tej gminy. Wybierz ją na mapie albo w wyszukiwarce.')
  known.set(terc, kept)
  return withArea(kept)
}

/** Towns and villages of a name; where a commune is named after the town, that one first ("Warszawa" the city, then villages). */
export async function localitiesNamed(geo: Geo, name: string): Promise<Locality[]> {
  const found = await geo.localities(name).catch(() => {
    throw new ApiError(503, 'unavailable', 'Wyszukiwarka miejscowości chwilowo nie działa. Kliknij gminę na mapie.')
  })
  const seat = (locality: Locality) => (locality.gmina.toLowerCase() === locality.name.toLowerCase() ? 0 : 1)
  return [...found].sort((a, b) => seat(a) - seat(b))
}
