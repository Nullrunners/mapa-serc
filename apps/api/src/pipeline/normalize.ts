/**
 * Turns one row of a provider's file into the fields of the pattern.
 * Whatever can be repaired safely is repaired and recorded as a fix; whatever cannot becomes an issue.
 * Pure functions: no network, no database.
 */
import { ACCESS, POLAND, STATUS, type Access, type AedInput, type MappingTarget, type Status } from '@aed/schema'
import type { Fix, Issue } from './types'

// -------------------------------------------------------------- coordinates

const inLat = (value: number) => value >= POLAND.minLat && value <= POLAND.maxLat
const inLon = (value: number) => value >= POLAND.minLon && value <= POLAND.maxLon

/** "52,3266", "52.3266", "52°19'36.1\"N", "N 52 19 36" → decimal degrees. */
export function parseCoordinate(text: string): { value: number; kind: 'decimal' | 'decimal_comma' | 'dms' } | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { value: Number(trimmed), kind: 'decimal' }
  if (/^-?\d+,\d+$/.test(trimmed)) return { value: Number(trimmed.replace(',', '.')), kind: 'decimal_comma' }
  const dms = trimmed.match(/^([NSEW])?\s*(\d{1,3})\s*[°ºd ]\s*(\d{1,2}(?:[.,]\d+)?)\s*['′m ]?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|''|s)?)?\s*([NSEW])?$/i)
  if (dms) {
    const [, prefix, degrees, minutes, seconds, suffix] = dms
    const number = (part: string | undefined) => (part ? Number(part.replace(',', '.')) : 0)
    const value = number(degrees) + number(minutes) / 60 + number(seconds) / 3600
    const hemisphere = (prefix ?? suffix ?? '').toUpperCase()
    return { value: hemisphere === 'S' || hemisphere === 'W' ? -value : value, kind: 'dms' }
  }
  return null
}

/** A transverse Mercator grid on GRS80: scale on the central meridian, that meridian in degrees, and the offsets. */
interface Grid {
  k0: number
  lon0: number
  falseEasting: number
  falseNorthing: number
}

/** Grid metres → WGS84, by the Krüger series. Accurate to centimetres, which is far more than an AED needs. */
function gridToWgs84(easting: number, northing: number, grid: Grid): { lat: number; lon: number } {
  const a = 6378137
  const f = 1 / 298.257222101
  const { k0 } = grid
  const lon0 = (grid.lon0 * Math.PI) / 180
  const n = f / (2 - f)
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64)
  const xi = (northing - grid.falseNorthing) / (k0 * A)
  const eta = (easting - grid.falseEasting) / (k0 * A)
  const beta = [n / 2 - (2 * n ** 2) / 3 + (37 * n ** 3) / 96, n ** 2 / 48 + n ** 3 / 15, (17 * n ** 3) / 480]
  let xiP = xi
  let etaP = eta
  beta.forEach((b, index) => {
    const j = 2 * (index + 1)
    xiP -= b * Math.sin(j * xi) * Math.cosh(j * eta)
    etaP -= b * Math.cos(j * xi) * Math.sinh(j * eta)
  })
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP))
  const delta = [2 * n - (2 * n ** 2) / 3 - 2 * n ** 3, (7 * n ** 2) / 3 - (8 * n ** 3) / 5, (56 * n ** 3) / 15]
  let lat = chi
  delta.forEach((d, index) => (lat += d * Math.sin(2 * (index + 1) * chi)))
  const lon = lon0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP))
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI }
}

/** PUWG 1992 (EPSG:2180, the Polish national grid) → WGS84. */
export const puwg1992ToWgs84 = (easting: number, northing: number): { lat: number; lon: number } =>
  gridToWgs84(easting, northing, { k0: 0.9993, lon0: 19, falseEasting: 500_000, falseNorthing: -5_300_000 })

/**
 * PUWG 2000 (EPSG:2176–2179), the grid of municipal surveying and city geoportals → WGS84. It has four zones
 * with central meridians 15°, 18°, 21° and 24°; the zone number (5–8) is the millions digit of the easting.
 * Null when the easting names no zone or lies further from the zone's meridian than a zone is wide.
 */
export function puwg2000ToWgs84(easting: number, northing: number): { lat: number; lon: number } | null {
  const zone = Math.floor(easting / 1_000_000)
  const falseEasting = zone * 1_000_000 + 500_000
  if (zone < 5 || zone > 8 || Math.abs(easting - falseEasting) > 150_000) return null
  return gridToWgs84(easting, northing, { k0: 0.999923, lon0: zone * 3, falseEasting, falseNorthing: 0 })
}

const round = (value: number) => Math.round(value * 1e7) / 1e7

/**
 * Resolves the pair a provider gave as (latitude, longitude). Recognises the two classic mistakes:
 * the columns the wrong way round, and grid coordinates (metres) instead of degrees.
 */
export function resolveCoordinates(
  latText: string,
  lonText: string,
): { lat: number | null; lon: number | null; fixes: Fix[]; issues: Issue[] } {
  const fixes: Fix[] = []
  const issues: Issue[] = []
  if (latText.trim() === '' && lonText.trim() === '') {
    return { lat: null, lon: null, fixes, issues: [{ code: 'coordinates_missing', severity: 'warning', message: 'Brak współrzędnych; system spróbuje ustalić je z adresu.' }] }
  }
  const first = parseCoordinate(latText)
  const second = parseCoordinate(lonText)
  if (!first || !second) {
    return {
      lat: null,
      lon: null,
      fixes,
      issues: [{ code: 'coordinates_invalid', severity: 'warning', message: `Nie udało się odczytać współrzędnych („${latText}", „${lonText}"); system spróbuje ustalić je z adresu.` }],
    }
  }
  const before = `${latText.trim()}; ${lonText.trim()}`
  if (first.kind === 'decimal_comma' || second.kind === 'decimal_comma') {
    fixes.push({ code: 'decimal_comma', field: 'szerokosc_geograficzna', message: 'Współrzędne miały przecinek dziesiętny; zamieniono go na kropkę.', before })
  }
  if (first.kind === 'dms' || second.kind === 'dms') {
    fixes.push({ code: 'coordinates_dms', field: 'szerokosc_geograficzna', message: 'Współrzędne były zapisane w stopniach, minutach i sekundach; przeliczono je na stopnie dziesiętne.', before })
  }

  let lat = first.value
  let lon = second.value

  // Metres, not degrees: a national grid. By Polish geodetic convention the first value (X) is the northing.
  // PUWG 1992 stays under a million in both values; PUWG 2000 has millions in both.
  if (Math.abs(lat) > 1000 && Math.abs(lon) > 1000) {
    const zoned = Math.abs(lat) >= 1_000_000 && Math.abs(lon) >= 1_000_000
    const convert = zoned ? puwg2000ToWgs84 : puwg1992ToWgs84
    const inPoland = (point: { lat: number; lon: number } | null) => point !== null && inLat(point.lat) && inLon(point.lon)
    const direct = convert(lon, lat)
    // In the westernmost zone of PUWG 2000 both readings of a pair can fall inside Poland; the convention decides.
    const converted = inPoland(direct) ? direct : convert(lat, lon)
    if (converted) {
      lat = converted.lat
      lon = converted.lon
      fixes.push({
        code: zoned ? 'coordinates_puwg2000' : 'coordinates_puwg1992',
        field: 'szerokosc_geograficzna',
        message: `Współrzędne były w układzie PUWG ${zoned ? '2000' : '1992'} (metry); przeliczono je na WGS84.`,
        before,
        after: `${round(lat)}; ${round(lon)}`,
      })
    }
  }

  if (!(inLat(lat) && inLon(lon)) && inLat(lon) && inLon(lat)) {
    ;[lat, lon] = [lon, lat]
    fixes.push({
      code: 'coordinates_swapped',
      field: 'szerokosc_geograficzna',
      message: 'Szerokość i długość geograficzna były zamienione miejscami; system je odwrócił.',
      before,
      after: `${round(lat)}; ${round(lon)}`,
    })
  }

  if (!(inLat(lat) && inLon(lon))) {
    return {
      lat: null,
      lon: null,
      fixes,
      issues: [{ code: 'coordinates_outside_poland', severity: 'warning', message: `Współrzędne (${before}) wskazują punkt poza Polską; system spróbuje ustalić je z adresu.` }],
    }
  }
  return { lat: round(lat), lon: round(lon), fixes, issues }
}

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h))
}

// ------------------------------------------------------------------ address

const STREET_KINDS: [RegExp, string][] = [
  [/^(?:ulica|ul)\b\.*\s*/i, 'ulica'],
  [/^(?:aleja|aleje|al)\b\.*\s*/i, 'aleja'],
  [/^(?:plac|pl)\b\.*\s*/i, 'plac'],
  [/^(?:osiedle|os)\b\.*\s*/i, 'osiedle'],
  [/^rondo\b\s*/i, 'rondo'],
  [/^skwer\b\s*/i, 'skwer'],
  [/^(?:bulwar|bulw)\b\.*\s*/i, 'bulwar'],
  [/^rynek\b(?=\s*\d|$)/i, 'rynek'],
]

const clean = (value: string) => value.replace(/\s+/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '')

/** "ul. Kazimierza Wielkiego 4" → kind, name and number. */
export function splitStreet(text: string): Pick<AedInput, 'cecha_ulicy' | 'nazwa_ulicy' | 'nr_budynku'> {
  let rest = clean(text)
  if (rest === '') return {}
  let kind: string | undefined
  for (const [pattern, name] of STREET_KINDS) {
    if (pattern.test(rest)) {
      kind = name
      // "Rynek 1" is both the kind and the name of the place.
      if (name !== 'rynek') rest = rest.replace(pattern, '')
      break
    }
  }
  // The number as offices type it: "28a", "17/21", "5/7/9", "2/ 4", "47 b".
  const number = rest.match(/^(.*?\D)\s+(\d+\s?[A-Za-z]?(?:\s?[/-]\s?\d+\s?[A-Za-z]?)*)$/)
  const street = clean(number ? number[1]! : rest)
  return {
    ...(kind ? { cecha_ulicy: kind } : {}),
    ...(street ? { nazwa_ulicy: street } : {}),
    ...(number ? { nr_budynku: number[2]!.replace(/\s/g, '') } : {}),
  }
}

/** "ul. Lwowska 28a, 38-400 Krosno" → structured address. */
export function splitAddress(text: string): Pick<AedInput, 'cecha_ulicy' | 'nazwa_ulicy' | 'nr_budynku' | 'kod_pocztowy' | 'miejscowosc'> {
  const value = clean(text)
  if (value === '') return {}
  const postcode = value.match(/(\d{2})\s?[-–]\s?(\d{3})/)
  if (postcode) {
    const before = clean(value.slice(0, postcode.index))
    const after = clean(value.slice(postcode.index! + postcode[0].length))
    // "38-400 Krosno, ul. Lwowska 28a" is as common as the other order.
    const [street, city] = before === '' && after.includes(',') ? [after.slice(after.indexOf(',') + 1), after.slice(0, after.indexOf(','))] : [before, after]
    return { ...splitStreet(street), kod_pocztowy: `${postcode[1]}-${postcode[2]}`, ...(clean(city) ? { miejscowosc: clean(city) } : {}) }
  }
  const comma = value.lastIndexOf(',')
  if (comma > 0 && !/\d/.test(value.slice(comma))) {
    return { ...splitStreet(value.slice(0, comma)), miejscowosc: clean(value.slice(comma + 1)) }
  }
  // "ul. Bydgoska 17/21 Łódź": the town follows the number with nothing in between. Only a capitalised word
  // without digits after a building number is taken for a town, so "ul. 3 Maja 12" stays a street.
  const town = value.match(/^(.*\d[A-Za-z]?)\s+(\p{Lu}[\p{L}.\- ]*)$/u)
  if (town) return { ...splitStreet(town[1]!), miejscowosc: clean(town[2]!) }
  return splitStreet(value)
}

// ------------------------------------------------------------- small values

const key = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()

const TRUE = new Set(['tak', 'yes', 'true', '1', 't', 'y', 'prawda'])
const FALSE = new Set(['nie', 'no', 'false', '0', 'n', 'f', 'falsz'])

export function parseBoolean(text: string): boolean | null {
  const value = key(text)
  return TRUE.has(value) ? true : FALSE.has(value) ? false : null
}

/**
 * Whether the device is inside a building: yes / no, or the words offices use ("Wewnątrz budynku",
 * "Na zewnątrz budynku"). Anything written after those words is returned as `rest`.
 */
export function parseIndoor(text: string): { indoor: boolean; rest: string } | null {
  const plain = parseBoolean(text)
  if (plain !== null) return { indoor: plain, rest: '' }
  const match = text.trim().match(/^(wewnątrz|w środku|na zewnątrz|zewnątrz)(?:\s+(?:budynku|obiektu))?\s*(?:[,;:–-]\s*(.*))?$/i)
  if (!match) return null
  return { indoor: !/zewn/i.test(match[1]!), rest: (match[2] ?? '').trim() }
}

const ACCESS_WORDS: Record<string, Access> = {
  publiczny: 'publiczny',
  yes: 'publiczny',
  tak: 'publiczny',
  public: 'publiczny',
  permissive: 'publiczny',
  permit: 'ograniczony',
  ogolnodostepny: 'publiczny',
  'ogolnie dostepny': 'publiczny',
  ograniczony: 'ograniczony',
  customers: 'ograniczony',
  'dla klientow': 'ograniczony',
  'w godzinach pracy': 'ograniczony',
  prywatny: 'prywatny',
  private: 'prywatny',
  no: 'prywatny',
  nie: 'prywatny',
  'tylko dla pracownikow': 'prywatny',
}

export const parseAccess = (text: string): Access | null => ACCESS_WORDS[key(text)] ?? ((ACCESS as readonly string[]).includes(text) ? (text as Access) : null)

const STATUS_WORDS: Record<string, Status> = {
  czynny: 'czynny',
  sprawny: 'czynny',
  aktywny: 'czynny',
  dziala: 'czynny',
  tak: 'czynny',
  'czasowo niedostepny': 'czasowo_niedostepny',
  niedostepny: 'czasowo_niedostepny',
  serwis: 'czasowo_niedostepny',
  'w serwisie': 'czasowo_niedostepny',
  niesprawny: 'czasowo_niedostepny',
  wycofany: 'wycofany',
  usuniety: 'wycofany',
  zlikwidowany: 'wycofany',
  nieznany: 'nieznany',
}

export const parseStatus = (text: string): Status | null =>
  STATUS_WORDS[key(text)] ?? ((STATUS as readonly string[]).includes(text) ? (text as Status) : null)

/** "22 766 72 00", "(22) 766-72-00", "+48 22 766 72 00" → "+48227667200". */
export function parsePhone(text: string): string | null {
  const first = text.split(/[;,]|\bwew\b|\blub\b/i)[0] ?? ''
  const digits = first.replace(/\D/g, '')
  if (first.trim().startsWith('+') && digits.length >= 9 && digits.length <= 15) return `+${digits}`
  if (digits.length === 9) return `+48${digits}`
  if (digits.length === 11 && digits.startsWith('48')) return `+${digits}`
  if (digits.length === 13 && digits.startsWith('0048')) return `+${digits.slice(2)}`
  return null
}

/** "1.10.2026", "01-10-2026", "2026-10-01" → "2026-10-01". */
export function parseDate(text: string): string | null {
  const value = text.trim()
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const polish = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  const parts = iso ? [iso[1]!, iso[2]!, iso[3]!] : polish ? [polish[3]!, polish[2]!.padStart(2, '0'), polish[1]!.padStart(2, '0')] : null
  if (!parts) return null
  const [year, month, day] = parts as [string, string, string]
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(day) ? null : `${year}-${month}-${day}`
}

const DAYS: [RegExp, string][] = [
  // "Dni robocze: poniedziałek 8-18, wtorek-piątek 8-16": the phrase only introduces the days that follow.
  [/dni (?:powszednie|robocze)[\s\-:(]*(?=poniedzial|pon\b|pn\b)/g, ''],
  // "Dni powszednie" may or may not include Saturday; Monday to Friday is the reading that never promises too much.
  [/dni powszednie|dni robocze/g, 'Mo-Fr'],
  [/poniedzial\w*|pon\b\.?|pn\b\.?/g, 'Mo'],
  [/wtor\w*|wt\b\.?/g, 'Tu'],
  [/srod\w*|sr\b\.?/g, 'We'],
  [/czwart\w*|czw\b\.?|cz\b\.?/g, 'Th'],
  [/piat\w*|pt\b\.?/g, 'Fr'],
  [/sobot\w*|sob\b\.?|sb\b\.?/g, 'Sa'],
  [/niedziel\w*|niedz\b\.?|nd\b\.?/g, 'Su'],
]

const hhmm = (hour: string, minute: string | undefined) => `${hour.padStart(2, '0')}:${(minute ?? '00').padStart(2, '0')}`

/**
 * Opening hours in the OpenStreetMap `opening_hours` syntax. Accepts that syntax as it is and the usual
 * Polish spellings ("całodobowo", "pn-pt 7.30-15.30", "poniedziałek–piątek 8-16, sobota 8-12").
 */
export function parseOpeningHours(text: string): string | null {
  const value = text.trim()
  if (value === '') return null
  if (/^(24\/7|(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/.test(value)) return value
  const plain = key(value)
  if (/calodobow|cala dobe|24 ?\/? ?h\b|24 ?\/ ?7|calodobowy|non stop/.test(plain)) return '24/7'

  let rest = value
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\b(?:w |od )?godz(?:in\w*|\.)?|\bod\b/g, ' ')
    .replace(/\bdo\b/g, '-')
  for (const [pattern, osm] of DAYS) rest = rest.replace(pattern, osm)
  rest = rest
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    // "soboty i niedziele" is a list of days, like "sobota, niedziela".
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su) i (?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, '$1,')
    // "w godz: 7.00-18.00" leaves the colon behind.
    .replace(/^[\s:;,.]+/, '')
    .trim()

  // "8.00-18.00 w dni robocze", "7:30-18:00, pon.-pt.": the hours come first.
  const reversed = rest.match(/^(\d{1,2})(?:[.:](\d{2}))?-(\d{1,2})(?:[.:](\d{2}))?[ ,]*(?:w )?((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)\.?$/)
  if (reversed) return `${reversed[5]} ${hhmm(reversed[1]!, reversed[2])}-${hhmm(reversed[3]!, reversed[4])}`

  const rules: string[] = []
  const rule = /((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)[ :,]*(\d{1,2})(?:[.:](\d{2}))?-(\d{1,2})(?:[.:](\d{2}))?/g
  let match: RegExpExecArray | null
  let consumed = 0
  while ((match = rule.exec(rest)) !== null) {
    // "Mo-Fr-Mo" is no list of days: the text was not understood, and a guess here could promise an open door.
    if (!/^\w\w(?:-\w\w)?(?:,\w\w(?:-\w\w)?)*$/.test(match[1]!)) return null
    rules.push(`${match[1]} ${hhmm(match[2]!, match[3])}-${hhmm(match[4]!, match[5])}`)
    consumed += match[0].length
  }
  if (rules.length > 0 && consumed >= rest.replace(/[;, ]/g, '').length * 0.6) return rules.join('; ')

  const bare = rest.match(/^(\d{1,2})(?:[.:](\d{2}))?-(\d{1,2})(?:[.:](\d{2}))?$/)
  if (bare) return `Mo-Su ${hhmm(bare[1]!, bare[2])}-${hhmm(bare[3]!, bare[4])}`
  return null
}

// ---------------------------------------------------------------- one row

const PERSONAL_EMAIL = /^[a-z]+[._][a-z]+(?:[._-][a-z]+)?@/i

/** Ways providers write "we do not know"; all of them mean an empty cell. */
const NO_VALUE = /^(?:unknown|brak(?: danych)?|b\.?\/?d\.?|n\/?a|nd\.?|null|none|-+|\?+)$/i

export interface RowResult {
  input: AedInput
  fixes: Fix[]
  issues: Issue[]
}

/** Applies a column mapping to one row and normalises every mapped value. */
export function normalizeRow(row: Record<string, string>, mapping: Record<string, MappingTarget | null>, defaults: AedInput = {}): RowResult {
  const input: Record<string, unknown> = { ...defaults }
  const fixes: Fix[] = []
  const issues: Issue[] = []
  let latText = ''
  let lonText = ''

  const set = (field: keyof AedInput, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') input[field] = value
  }
  const unrecognised = (field: string, value: string) =>
    issues.push({ code: 'value_not_recognised', severity: 'warning', field, message: `Wartość „${value}" w polu ${field} nie pasuje do wzorca i została pominięta.` })

  for (const [column, target] of Object.entries(mapping)) {
    const value = clean(row[column] ?? '')
    if (!target || value === '' || NO_VALUE.test(value)) continue
    switch (target) {
      case 'szerokosc_geograficzna':
        latText = value
        break
      case 'dlugosc_geograficzna':
        lonText = value
        break
      case 'wspolrzedne': {
        const json = value.startsWith('{') ? (JSON.parse(value) as Record<string, unknown>) : null
        const pair = json ? [json.lat ?? json.latitude, json.long ?? json.lng ?? json.lon ?? json.longitude].map((part) => String(part ?? '')) : value.split(/[;,\s]+(?=-?\d)/)
        // A decimal comma would split into four parts; then the pair is "a,b c,d".
        const parts = pair.length === 4 ? [`${pair[0]},${pair[1]}`, `${pair[2]},${pair[3]}`] : pair
        latText = parts[0] ?? ''
        lonText = parts[1] ?? ''
        break
      }
      case 'adres': {
        const parts = splitAddress(value)
        for (const [field, part] of Object.entries(parts)) set(field as keyof AedInput, part)
        fixes.push({ code: 'address_split', field: 'nazwa_ulicy', message: 'Adres był w jednej kolumnie; rozdzielono go na ulicę, numer, kod pocztowy i miejscowość.', before: value })
        break
      }
      case 'ulica':
        for (const [field, part] of Object.entries(splitStreet(value))) set(field as keyof AedInput, part)
        break
      case 'nazwa_ulicy': {
        // Providers often put "ul. Jasna" in the street-name column; the pattern wants the bare name.
        const parts = splitStreet(value)
        set('nazwa_ulicy', parts.nazwa_ulicy)
        if (parts.cecha_ulicy && input.cecha_ulicy === undefined) set('cecha_ulicy', parts.cecha_ulicy)
        if (parts.nr_budynku && input.nr_budynku === undefined) set('nr_budynku', parts.nr_budynku)
        break
      }
      case 'kod_pocztowy': {
        const match = value.match(/^(\d{2})\s?-?\s?(\d{3})$/)
        if (!match) unrecognised(target, value)
        else {
          const formatted = `${match[1]}-${match[2]}`
          if (formatted !== value) fixes.push({ code: 'postcode_format', field: target, message: 'Poprawiono zapis kodu pocztowego.', before: value, after: formatted })
          set(target, formatted)
        }
        break
      }
      case 'kod_terc':
      case 'kod_simc': {
        const digits = value.replace(/\D/g, '')
        // A six-digit TERC lacks the commune-type digit; it is completed from the coordinates later.
        if (digits.length === 7) set(target, digits)
        break
      }
      case 'wewnatrz_budynku': {
        const parsed = parseIndoor(value)
        if (parsed === null) unrecognised(target, value)
        else {
          set(target, parsed.indoor)
          // "Wewnątrz budynku, peron w kierunku Kabaty": the words after the answer say where exactly; keep them.
          if (parsed.rest) set('opis_lokalizacji', [input.opis_lokalizacji, parsed.rest].filter(Boolean).join('; '))
        }
        break
      }
      case 'elektrody_pediatryczne': {
        const parsed = parseBoolean(value)
        if (parsed === null) unrecognised(target, value)
        else set(target, parsed)
        break
      }
      case 'dostep': {
        const parsed = parseAccess(value)
        if (parsed === null) unrecognised(target, value)
        else set(target, parsed)
        break
      }
      case 'status': {
        const parsed = parseStatus(value)
        if (parsed === null) unrecognised(target, value)
        else set(target, parsed)
        break
      }
      case 'godziny_dostepnosci': {
        const parsed = parseOpeningHours(value)
        if (parsed === null) {
          // Better to keep the provider's words where a rescuer can read them than to lose them.
          set('uwagi_dostepu', [input.uwagi_dostepu, `Godziny: ${value}`].filter(Boolean).join('; '))
          unrecognised(target, value)
        } else {
          if (parsed !== value) fixes.push({ code: 'value_mapped', field: target, message: 'Godziny dostępności zapisano w składni opening_hours.', before: value, after: parsed })
          set(target, parsed)
        }
        break
      }
      case 'telefon_kontaktowy': {
        const parsed = parsePhone(value)
        if (parsed === null) unrecognised(target, value)
        else {
          if (parsed !== value) fixes.push({ code: 'phone_format', field: target, message: 'Ujednolicono zapis numeru telefonu.', before: value, after: parsed })
          set(target, parsed)
        }
        break
      }
      case 'email_kontaktowy': {
        const email = value.toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) unrecognised(target, value)
        else {
          if (PERSONAL_EMAIL.test(email)) {
            issues.push({ code: 'personal_data_suspected', severity: 'warning', field: target, message: `Adres ${email} wygląda na imienny. W zbiorze publicznym podaj adres instytucji.` })
          }
          set(target, email)
        }
        break
      }
      case 'data_weryfikacji':
      case 'termin_waznosci_elektrod':
      case 'termin_waznosci_baterii':
      case 'termin_waznosci_elektrod_pediatrycznych': {
        const parsed = parseDate(value)
        if (parsed === null) unrecognised(target, value)
        else {
          if (parsed !== value) fixes.push({ code: 'date_format', field: target, message: 'Datę zapisano w formacie RRRR-MM-DD.', before: value, after: parsed })
          set(target, parsed)
        }
        break
      }
      case 'cecha_ulicy':
        set(target, value.toLowerCase().replace(/\.$/, '').replace(/^ul$/, 'ulica').replace(/^al$/, 'aleja').replace(/^pl$/, 'plac').replace(/^os$/, 'osiedle'))
        break
      case 'id':
      case 'zrodlo':
      case 'licencja':
      case 'data_aktualizacji':
        break
      default:
        set(target, value)
    }
  }

  if (latText !== '' || lonText !== '' || !('szerokosc_geograficzna' in input)) {
    const resolved = resolveCoordinates(latText, lonText)
    fixes.push(...resolved.fixes)
    issues.push(...resolved.issues)
    if (resolved.lat !== null && resolved.lon !== null) {
      input.szerokosc_geograficzna = resolved.lat
      input.dlugosc_geograficzna = resolved.lon
    }
  }
  if (!input.nazwa) issues.push({ code: 'name_missing', severity: 'error', field: 'nazwa', message: 'Brak nazwy miejsca.' })

  return { input: input as AedInput, fixes, issues }
}
