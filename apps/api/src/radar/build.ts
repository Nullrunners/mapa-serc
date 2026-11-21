/**
 * Radar AED: leads to devices that exist but are missing from the official dataset.
 *
 *  osm_gap      devices the OpenStreetMap community knows, grouped by commune and by operator, set against what
 *               the official dataset has there. No model involved; the evidence is the map itself.
 *  procurement  public buyers who purchased AEDs (e-Zamówienia result notices, CPV 33182100-0). A notice says who
 *               bought, not where the devices hang, so this is a lead to an organisation, not to a location.
 *
 * A lead never becomes a record by itself: an operator invites the owner, and the owner's submission does.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from '../db/store'
import { textKey } from '../pipeline/dedup'
import type { Geo } from '../pipeline/geocode'

export type CandidateKind = 'osm_gap' | 'procurement' | 'web'
export type CandidateStatus = 'new' | 'invited' | 'confirmed' | 'rejected'

export interface Candidate {
  id: string
  kind: CandidateKind
  status: CandidateStatus
  title: string
  organisation: string | null
  nip: string | null
  kodTerc: string | null
  locality: string | null
  devices: number | null
  registered: number | null
  evidence: { url: string; quote: string; date: string | null }
  confidence: number
  lat: number | null
  lon: number | null
}

const devicesWord = (count: number) => (count === 1 ? 'urządzenie' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'urządzenia' : 'urządzeń')
const communesWord = (count: number) => (count === 1 ? 'gminie' : 'gminach')
const round = (value: number) => Math.round(value * 1e5) / 1e5
const mapLink = (lat: number, lon: number, zoom: number) => `https://openaedmap.org/#map=${zoom}/${round(lat)}/${round(lon)}`

const slug = (text: string) => textKey(text).replaceAll(' ', '-').slice(0, 48)

// ------------------------------------------------------------------ OSM gap

/** Operators with fewer devices than this are too small for a nationwide lead; they show up in their commune. */
const MIN_OPERATOR_DEVICES = 5

export function osmGapCandidates(store: Store, today: string): Candidate[] {
  const community = store.aeds.filter((aed) => aed.publication === 'community')
  const officialByTerc = new Map<string, number>()
  for (const aed of store.aeds) {
    if (aed.publication === 'official' && aed.record.kod_terc) officialByTerc.set(aed.record.kod_terc, (officialByTerc.get(aed.record.kod_terc) ?? 0) + 1)
  }

  const candidates: Candidate[] = []

  const byCommune = new Map<string, typeof community>()
  for (const aed of community) {
    if (!aed.record.kod_terc) continue
    byCommune.set(aed.record.kod_terc, [...(byCommune.get(aed.record.kod_terc) ?? []), aed])
  }
  for (const [terc, devices] of byCommune) {
    const registered = officialByTerc.get(terc) ?? 0
    const lat = devices.reduce((sum, aed) => sum + aed.record.szerokosc_geograficzna, 0) / devices.length
    const lon = devices.reduce((sum, aed) => sum + aed.record.dlugosc_geograficzna, 0) / devices.length
    const locality = devices[0]!.record.miejscowosc ?? null
    candidates.push({
      id: `osm-gmina-${terc}`,
      kind: 'osm_gap',
      status: 'new',
      title: `${locality ?? terc}: ${devices.length} ${devicesWord(devices.length)} na mapie społeczności, ${registered} w zbiorze urzędowym`,
      organisation: null,
      nip: null,
      kodTerc: terc,
      locality,
      devices: devices.length,
      registered,
      evidence: { url: mapLink(lat, lon, 12), quote: `${devices.length} obiektów emergency=defibrillator w OpenStreetMap na terenie gminy ${locality ?? terc}`, date: today },
      confidence: 0.9,
      lat: round(lat),
      lon: round(lon),
    })
  }

  const byOperator = new Map<string, typeof community>()
  for (const aed of community) {
    const operator = aed.record.podmiot_odpowiedzialny
    if (!operator) continue
    const key = textKey(operator)
    if (key.length < 3) continue
    byOperator.set(key, [...(byOperator.get(key) ?? []), aed])
  }
  for (const [key, devices] of byOperator) {
    if (devices.length < MIN_OPERATOR_DEVICES) continue
    // The spelling most mappers used is the one to show.
    const spellings = new Map<string, number>()
    for (const aed of devices) spellings.set(aed.record.podmiot_odpowiedzialny!, (spellings.get(aed.record.podmiot_odpowiedzialny!) ?? 0) + 1)
    const name = [...spellings].sort((a, b) => b[1] - a[1])[0]![0]
    const communes = new Set(devices.map((aed) => aed.record.kod_terc).filter(Boolean)).size
    const first = devices[0]!.record
    candidates.push({
      id: `osm-operator-${slug(key)}`,
      kind: 'osm_gap',
      status: 'new',
      title: `${name}: ${devices.length} ${devicesWord(devices.length)} w ${communes} ${communesWord(communes)} na mapie społeczności`,
      organisation: name,
      nip: null,
      kodTerc: null,
      locality: null,
      devices: devices.length,
      registered: null,
      evidence: { url: mapLink(first.szerokosc_geograficzna, first.dlugosc_geograficzna, 16), quote: `operator=${name} przy ${devices.length} obiektach emergency=defibrillator w OpenStreetMap`, date: today },
      confidence: 0.8,
      lat: null,
      lon: null,
    })
  }
  return candidates
}

// -------------------------------------------------------------- procurement

interface Notice {
  objectId: string
  bzpNumber: string
  tenderId: string
  noticeNumber: string
  publicationDate: string
  orderObject: string
  procedureResult: string | null
  organizationName: string
  organizationCity: string
  organizationNationalId: string | null
}

const ABOUT_AED = /\bAED\b|defibrylator/i
/** Same CPV code, different thing: training dummies, implants, hospital equipment and its accessories. */
const NOT_PUBLIC_AED = /treningow|szkoleniow|fantom|wszczepia|kardiowerter|stymulator|szpitaln|manualn|transportow|reanimacyjn|opieki zdrowotnej|spzoz|\bzoz\b|karetk|ambulans|osprzęt|akcesori|elektrod|bateri|serwis|przegląd/i
const CLINICAL_BUYER = /szpital|zoz\b|zdrow|medycz|klinik|pogotow|ratownictw|onkolog|uniwersytet|instytut|krwiodaw|sanatori|uzdrowisk/i
/** Words that point to devices put up for the public rather than carried in a vehicle. */
const PUBLIC_PLACE = /ogólnodostępn|publiczn|kapsu|zewnętrzn|szafk|tablic|montaż|instalacj|placów|szk[oó]ł|obiekt/i
const MOBILE_UNIT = /policj|straż|wojsk|komenda|radiowoz|pojazd/i
const COUNT = /(\d{1,3})\s*(?:szt\.?|sztuk|zestaw\w*|kompletów)?\s*(?:ogólnodostępnych\s+|automatycznych\s+|zewnętrznych\s+)*(?:defibrylator|AED)/i

const NOTICES_URL = 'https://ezamowienia.gov.pl/mo-board/api/v1/notice'
/** CPV 33182100-0: defibrillators. */
const CPV = '33182100-0'
const FIRST_YEAR = 2021

/**
 * Downloads the result notices year by year into data/raw/ezamowienia (the API needs no key).
 * With `onlyMissing` only years without a file are fetched, plus the current year, which keeps growing.
 */
export async function fetchNotices(rawDir: string, today: string, onlyMissing: boolean): Promise<{ year: number; notices: number | null }[]> {
  const dir = join(rawDir, 'ezamowienia')
  mkdirSync(dir, { recursive: true })
  const thisYear = Number(today.slice(0, 4))
  const fetched: { year: number; notices: number | null }[] = []
  for (let year = FIRST_YEAR; year <= thisYear; year++) {
    const file = join(dir, `result-${year}.json`)
    if (onlyMissing && year !== thisYear && existsSync(file)) continue
    const query = new URLSearchParams({
      NoticeType: 'TenderResultNotice',
      CpvCode: CPV,
      PublicationDateFrom: `${year}-01-01`,
      PublicationDateTo: `${year}-12-31`,
      PageSize: '500',
      PageNumber: '1',
    })
    try {
      const response = await fetch(`${NOTICES_URL}?${query}`, { signal: AbortSignal.timeout(180_000), headers: { 'User-Agent': 'aed-hub/0.1' } })
      const body = (await response.json()) as unknown
      if (!response.ok || !Array.isArray(body)) throw new Error(`HTTP ${response.status}`)
      writeFileSync(file, JSON.stringify(body))
      fetched.push({ year, notices: body.length })
    } catch {
      // Keep the copy we have; the lead list is then built from the last successful download.
      fetched.push({ year, notices: null })
    }
  }
  return fetched
}

/** Result notices kept as downloaded (data/raw/ezamowienia/*.json), newest first, one per tender. */
export function readNotices(rawDir: string | null): Notice[] {
  const dir = rawDir ? join(rawDir, 'ezamowienia') : null
  if (!dir || !existsSync(dir)) return []
  const notices: Notice[] = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown
      if (Array.isArray(parsed)) notices.push(...(parsed as Notice[]))
    } catch {
      // A truncated download: skip the file, the others still count.
    }
  }
  const byTender = new Map<string, Notice>()
  for (const notice of notices.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate))) {
    if (!byTender.has(notice.tenderId)) byTender.set(notice.tenderId, notice)
  }
  return [...byTender.values()]
}

export const isPublicAedPurchase = (notice: Notice): boolean =>
  ABOUT_AED.test(notice.orderObject) &&
  !NOT_PUBLIC_AED.test(notice.orderObject) &&
  (notice.procedureResult ?? '').includes('zawarcieUmowy') &&
  !CLINICAL_BUYER.test(notice.organizationName)

export async function procurementCandidates(store: Store, geo: Geo, rawDir: string | null): Promise<Candidate[]> {
  const officialByTerc = new Map<string, number>()
  for (const aed of store.aeds) {
    if (aed.publication === 'official' && aed.record.kod_terc) officialByTerc.set(aed.record.kod_terc, (officialByTerc.get(aed.record.kod_terc) ?? 0) + 1)
  }

  const candidates: Candidate[] = []
  for (const notice of readNotices(rawDir).filter(isPublicAedPurchase)) {
    // The buyer's seat places the lead on the map; the devices themselves may be anywhere in its area.
    let place: { lat: number; lon: number } | null = null
    let terc: string | null = null
    try {
      place = await geo.address(notice.organizationCity)
      terc = place ? ((await geo.commune(place.lat, place.lon))?.terc ?? null) : null
    } catch {
      // Register unavailable: the lead is still useful without a commune code.
    }
    const subject = notice.orderObject.replace(/\s+/g, ' ').trim()
    const count = subject.match(COUNT)
    candidates.push({
      id: `bzp-${notice.bzpNumber.replace(/[^0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      kind: 'procurement',
      status: 'new',
      title: `${notice.organizationName}: ${subject.length > 160 ? `${subject.slice(0, 157)}…` : subject}`,
      organisation: notice.organizationName,
      nip: notice.organizationNationalId || null,
      kodTerc: terc,
      locality: notice.organizationCity || null,
      devices: count ? Number(count[1]) : null,
      registered: terc ? (officialByTerc.get(terc) ?? 0) : null,
      evidence: {
        url: `https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details/id/${notice.objectId}`,
        // The subject of the contract, word for word as published in the notice.
        quote: subject,
        date: notice.publicationDate.slice(0, 10),
      },
      confidence: MOBILE_UNIT.test(`${notice.organizationName} ${subject}`) ? 0.3 : PUBLIC_PLACE.test(subject) ? 0.8 : 0.5,
      lat: place ? round(place.lat) : null,
      lon: place ? round(place.lon) : null,
    })
  }
  return candidates
}

/** Most promising first: leads with a known number of devices, then by confidence. */
export function rank(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => (b.devices ?? 0) - (a.devices ?? 0) || b.confidence - a.confidence || a.id.localeCompare(b.id))
}
