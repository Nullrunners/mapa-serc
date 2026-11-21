/**
 * Decides which records from different sources describe the same device.
 * Pure functions over plain arrays, so the thresholds can be tuned against labelled pairs in a test.
 */
import { distanceM } from './normalize'

/** Starting thresholds; calibrate on pairs known to match before trusting the automatic merges. */
export const DEDUP = {
  /** Records further apart than this are never the same device. */
  maxDistanceM: 150,
  /** Up to this distance the position alone counts as a full match. */
  sameSpotM: 15,
  nearM: 50,
  sameSpotName: 0.85,
  nearName: 0.92,
  autoScore: 0.8,
  reviewScore: 0.55,
  weights: { geo: 0.45, name: 0.3, address: 0.25 },
} as const

export interface DedupItem {
  /** Position in the caller's array. */
  index: number
  sourceId: string
  priority: number
  lat: number
  lon: number
  name: string
  street: string
  number: string
}

const NOISE = new Set(['defibrylator', 'aed', 'ul', 'al', 'ulica', 'aleja', 'im', 'w', 'nr', 'sp', 'z', 'o', 'oo'])

/** Comparison key of a name or street: lower case, no diacritics, no filler words. */
export function textKey(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token !== '' && !NOISE.has(token))
    .join(' ')
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a === '' ? 0 : 1
  if (a === '' || b === '') return 0
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const matchedA = new Array<boolean>(a.length).fill(false)
  const matchedB = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const from = Math.max(0, i - window)
    const to = Math.min(b.length - 1, i + window)
    for (let j = from; j <= to; j++) {
      if (matchedB[j] || a[i] !== b[j]) continue
      matchedA[i] = matchedB[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!matchedA[i]) continue
    while (!matchedB[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && prefix < a.length && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

/** Share of common words; robust to word order ("SP nr 2 Marki" vs "Marki, SP nr 2"). */
export function tokenJaccard(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean))
  const right = new Set(b.split(' ').filter(Boolean))
  if (left.size === 0 || right.size === 0) return 0
  let common = 0
  for (const token of left) if (right.has(token)) common++
  return common / (left.size + right.size - common)
}

export interface Comparison {
  decision: 'auto' | 'review' | 'different'
  score: number
  distanceM: number
  nameSimilarity: number
}

export function compare(a: DedupItem, b: DedupItem): Comparison {
  const distance = distanceM(a.lat, a.lon, b.lat, b.lon)
  if (distance > DEDUP.maxDistanceM) return { decision: 'different', score: 0, distanceM: distance, nameSimilarity: 0 }

  const nameA = textKey(a.name)
  const nameB = textKey(b.name)
  const name = Math.max(jaroWinkler(nameA, nameB), tokenJaccard(nameA, nameB))
  const streetA = textKey(a.street)
  const streetB = textKey(b.street)
  const hasAddress = streetA !== '' && streetB !== ''
  const sameAddress = hasAddress && streetA === streetB && a.number !== '' && a.number.toLowerCase() === b.number.toLowerCase()
  const address = hasAddress ? (sameAddress ? 1 : tokenJaccard(`${streetA} ${a.number}`.toLowerCase(), `${streetB} ${b.number}`.toLowerCase())) : null

  const geo = distance <= DEDUP.sameSpotM ? 1 : 1 - (distance - DEDUP.sameSpotM) / (DEDUP.maxDistanceM - DEDUP.sameSpotM)
  const { weights } = DEDUP
  // A source without addresses (OSM mostly) must not be punished for it: the address weight is shared out.
  const score =
    address === null ? (weights.geo * geo + weights.name * name) / (weights.geo + weights.name) : weights.geo * geo + weights.name * name + weights.address * address

  const certain =
    (distance <= DEDUP.sameSpotM && (name >= DEDUP.sameSpotName || sameAddress)) || (distance <= DEDUP.nearM && name >= DEDUP.nearName)
  const decision = certain || score >= DEDUP.autoScore ? 'auto' : score >= DEDUP.reviewScore ? 'review' : 'different'
  return { decision, score: Math.round(score * 1000) / 1000, distanceM: Math.round(distance), nameSimilarity: Math.round(name * 1000) / 1000 }
}

export interface ReviewPair {
  a: number
  b: number
  score: number
  distanceM: number
}

const CELL_DEG = 0.002

/**
 * Groups items into devices. Items are taken in order of source priority; each joins the best existing
 * cluster it certainly matches, otherwise starts its own. A cluster never holds two items of one source:
 * two AEDs in one school are two AEDs.
 */
export function cluster(items: DedupItem[]): { clusters: number[][]; reviews: ReviewPair[] } {
  const ordered = [...items].sort((a, b) => b.priority - a.priority || a.sourceId.localeCompare(b.sourceId) || a.index - b.index)
  const byIndex = new Map(items.map((item) => [item.index, item]))
  const clusters: number[][] = []
  const clusterOf = new Map<number, number>()
  const grid = new Map<string, number[]>()
  const reviews: ReviewPair[] = []
  const cell = (lat: number, lon: number) => [Math.floor(lat / CELL_DEG), Math.floor(lon / (CELL_DEG * 1.6))] as const

  for (const item of ordered) {
    const [row, column] = cell(item.lat, item.lon)
    let best: { clusterId: number; comparison: Comparison; other: number } | null = null
    const pending: ReviewPair[] = []
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dColumn = -1; dColumn <= 1; dColumn++) {
        for (const otherIndex of grid.get(`${row + dRow}:${column + dColumn}`) ?? []) {
          const other = byIndex.get(otherIndex)!
          const clusterId = clusterOf.get(otherIndex)!
          if (clusters[clusterId]!.some((member) => byIndex.get(member)!.sourceId === item.sourceId)) continue
          const comparison = compare(item, other)
          if (comparison.decision === 'auto' && (!best || comparison.score > best.comparison.score)) best = { clusterId, comparison, other: otherIndex }
          if (comparison.decision === 'review') pending.push({ a: otherIndex, b: item.index, score: comparison.score, distanceM: comparison.distanceM })
        }
      }
    }
    let clusterId: number
    if (best) {
      clusterId = best.clusterId
      clusters[clusterId]!.push(item.index)
    } else {
      clusterId = clusters.push([item.index]) - 1
      reviews.push(...pending)
    }
    clusterOf.set(item.index, clusterId)
    const cellKey = `${row}:${column}`
    grid.set(cellKey, [...(grid.get(cellKey) ?? []), item.index])
  }
  return { clusters, reviews }
}
