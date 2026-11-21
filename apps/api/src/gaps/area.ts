/**
 * The area of one analysis: a box, and inside it optionally a shape (a lasso drawn on the map, a commune).
 * Shapes follow GeoJSON: polygons of rings of [lon, lat], the first ring of a polygon its outline, the rest its holes.
 * A point counts as inside by the even-odd rule over all rings, so holes (a town inside a rural commune), separate
 * parts and a lasso that crosses itself all behave the way they look on the map.
 */

export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number]
export type Ring = [lon: number, lat: number][]
export type Shape = Ring[][]

export interface Area {
  bbox: Bbox
  /** null: the whole box. */
  shape: Shape | null
}

/** Most corners a drawn shape may have; the browser simplifies a lasso below this. */
export const MAX_VERTICES = 100

export function parseBbox(text: string): Bbox {
  const [a, b, c, d] = text.split(',').map(Number) as [number, number, number, number]
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

/** "lon,lat;lon,lat;…" → a closed ring, or null when it is not one. */
export function parseRing(text: string): Ring | null {
  const ring = text.split(';').map((pair) => pair.split(',').map(Number) as [number, number])
  if (ring.some((point) => point.length !== 2 || !point.every(Number.isFinite))) return null
  const [first, last] = [ring[0]!, ring.at(-1)!]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
  return ring.length >= 4 && ring.length <= MAX_VERTICES + 1 ? ring : null
}

/** POLYGON or MULTIPOLYGON in WKT (with or without "SRID=4326;"), as a shape; null when it is neither. */
export function parseWkt(text: string): Shape | null {
  const body = text.replace(/^SRID=\d+;/i, '').trim()
  const kind = /^(MULTIPOLYGON|POLYGON)\s*/i.exec(body)
  if (!kind) return null
  const ringDepth = kind[1]!.toUpperCase() === 'MULTIPOLYGON' ? 3 : 2
  const shape: Shape = []
  let polygon: Ring[] = []
  let depth = 0
  let start = 0
  for (let i = kind[0].length; i < body.length; i++) {
    const char = body[i]
    if (char === '(') {
      depth++
      if (depth === ringDepth - 1) polygon = []
      if (depth === ringDepth) start = i + 1
    } else if (char === ')') {
      if (depth === ringDepth) polygon.push(body.slice(start, i).split(',').map((pair) => pair.trim().split(/\s+/).map(Number) as [number, number]))
      if (depth === ringDepth - 1 && polygon.length > 0) shape.push(polygon)
      depth--
    }
  }
  const valid = shape.length > 0 && shape.every((rings) => rings.every((ring) => ring.length >= 4 && ring.every((point) => point.length === 2 && point.every(Number.isFinite))))
  return valid ? shape : null
}

export function bboxOf(shape: Shape): Bbox {
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const rings of shape) {
    for (const [lon, lat] of rings[0] ?? []) {
      bbox[0] = Math.min(bbox[0], lon)
      bbox[1] = Math.min(bbox[1], lat)
      bbox[2] = Math.max(bbox[2], lon)
      bbox[3] = Math.max(bbox[3], lat)
    }
  }
  return bbox
}

export const shapeArea = (shape: Shape): Area => ({ bbox: bboxOf(shape), shape })

function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function inShape(shape: Shape, lon: number, lat: number): boolean {
  let inside = false
  for (const rings of shape) for (const ring of rings) if (inRing(ring, lon, lat)) inside = !inside
  return inside
}

export function inArea(area: Area, lon: number, lat: number): boolean {
  const [minLon, minLat, maxLon, maxLat] = area.bbox
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false
  return area.shape === null || inShape(area.shape, lon, lat)
}

/** Kilometres per degree in Poland, close enough for areas and distances of a few kilometres. */
const KM_PER_LAT = 111.2
const kmPerLon = (lat: number) => KM_PER_LAT * Math.cos((lat * Math.PI) / 180)

/** Shortest distance in km from a point to the outline of a shape. */
export function kmToEdge(shape: Shape, lon: number, lat: number): number {
  const kx = kmPerLon(lat)
  let best = Infinity
  for (const rings of shape) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = [(ring[i - 1]![0] - lon) * kx, (ring[i - 1]![1] - lat) * KM_PER_LAT]
        const [bx, by] = [(ring[i]![0] - lon) * kx, (ring[i]![1] - lat) * KM_PER_LAT]
        const [dx, dy] = [bx - ax, by - ay]
        const length = dx * dx + dy * dy
        const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length))
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
      }
    }
  }
  return best
}

function ringKm2(ring: Ring): number {
  const kx = kmPerLon(ring[0]![1])
  let sum = 0
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1]![0] * kx * ring[i]![1] * KM_PER_LAT - ring[i]![0] * kx * ring[i - 1]![1] * KM_PER_LAT
  return Math.abs(sum) / 2
}

/** Square kilometres inside the area: outlines minus holes. */
export function areaKm2(area: Area): number {
  if (area.shape) return area.shape.reduce((sum, [outline, ...holes]) => sum + ringKm2(outline!) - holes.reduce((inner, hole) => inner + ringKm2(hole), 0), 0)
  const [minLon, minLat, maxLon, maxLat] = area.bbox
  return (maxLon - minLon) * kmPerLon((minLat + maxLat) / 2) * (maxLat - minLat) * KM_PER_LAT
}

/** Distance from p to the segment a–b, in degrees (only compared with a tolerance in degrees). */
function offset(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function simplifyLine(points: Ring, tolerance: number): Ring {
  if (points.length <= 2) return points
  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const distance = offset(points[i]!, points[0]!, points.at(-1)!)
    if (distance > worst) [worst, index] = [distance, i]
  }
  if (worst <= tolerance) return [points[0]!, points.at(-1)!]
  return [...simplifyLine(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(index), tolerance)]
}

/**
 * Douglas–Peucker on a closed ring. The ring starts and ends in the same point, so it is cut in two at the corner
 * farthest from its start first. Null when nothing of the ring is left (an islet smaller than the tolerance).
 */
export function simplifyRing(ring: Ring, tolerance: number): Ring | null {
  let far = 0
  ring.forEach((point, i) => {
    if (Math.hypot(point[0] - ring[0]![0], point[1] - ring[0]![1]) > Math.hypot(ring[far]![0] - ring[0]![0], ring[far]![1] - ring[0]![1])) far = i
  })
  const simple = [...simplifyLine(ring.slice(0, far + 1), tolerance).slice(0, -1), ...simplifyLine(ring.slice(far), tolerance)]
  return simple.length >= 4 ? simple.map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]) : null
}

export function simplifyShape(shape: Shape, tolerance: number): Shape {
  const simple: Shape = []
  for (const [outline, ...holes] of shape) {
    const kept = simplifyRing(outline!, tolerance)
    if (kept) simple.push([kept, ...holes.map((hole) => simplifyRing(hole, tolerance)).filter((hole): hole is Ring => hole !== null)])
  }
  return simple
}
