/**
 * Proposes which column of a provider's file is which field of the pattern, so that a clerk only confirms.
 * Two kinds of evidence: what the header says (synonyms) and what the values look like (profile).
 * Values win over the header when they disagree: a column titled "długość" that holds 52.3… is a latitude.
 */
import { POLAND, SYNONYMS, headerKey, type MappingTarget } from '@aed/schema'
import { parseCoordinate } from './normalize'
import { GEO_LAT, GEO_LON } from './parse'
import type { RawTable } from './types'

export interface ColumnSuggestion {
  header: string
  target: MappingTarget | null
  confidence: number
  /** Why, in words a clerk can check. */
  reason: string
  samples: string[]
}

const share = (values: string[], test: (value: string) => boolean) => (values.length === 0 ? 0 : values.filter(test).length / values.length)

const isLat = (value: string) => {
  const parsed = parseCoordinate(value)
  return parsed !== null && parsed.value >= POLAND.minLat && parsed.value <= POLAND.maxLat
}
const isLon = (value: string) => {
  const parsed = parseCoordinate(value)
  return parsed !== null && parsed.value >= POLAND.minLon && parsed.value <= POLAND.maxLon
}
const POSTCODE = /^\d{2}-?\d{3}$/
const HAS_POSTCODE = /\d{2}-\d{3}\s+\p{L}/u
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
const PHONE = /^\+?[\d\s()-]{9,17}$/
const PAIR = /^\s*-?\d{1,2}[.,]\d+\s*[,; ]\s*-?\d{1,2}[.,]\d+\s*$/

/** Targets where the same value in every row is normal (one town, one operator) rather than a sign of a label column. */
const CONSTANT_OK = new Set<MappingTarget>([
  'miejscowosc',
  'kod_pocztowy',
  'kod_terc',
  'kod_simc',
  'cecha_ulicy',
  'dostep',
  'status',
  'godziny_dostepnosci',
  'podmiot_odpowiedzialny',
  'telefon_kontaktowy',
  'email_kontaktowy',
  'producent',
  'model',
  'wewnatrz_budynku',
  'elektrody_pediatryczne',
  'data_weryfikacji',
])

interface Evidence {
  target: MappingTarget | null
  confidence: number
  reason: string
}

function fromValues(values: string[]): Evidence | null {
  if (values.length === 0) return null
  if (share(values, isLat) >= 0.8) return { target: 'szerokosc_geograficzna', confidence: 0.9, reason: 'wartości leżą w zakresie szerokości geograficznej Polski (49–55)' }
  if (share(values, isLon) >= 0.8) return { target: 'dlugosc_geograficzna', confidence: 0.9, reason: 'wartości leżą w zakresie długości geograficznej Polski (14–24)' }
  if (share(values, (value) => PAIR.test(value)) >= 0.8) return { target: 'wspolrzedne', confidence: 0.85, reason: 'obie współrzędne w jednej komórce' }
  if (share(values, (value) => POSTCODE.test(value)) >= 0.8) return { target: 'kod_pocztowy', confidence: 0.9, reason: 'wartości wyglądają jak kody pocztowe' }
  if (share(values, (value) => EMAIL.test(value)) >= 0.8) return { target: 'email_kontaktowy', confidence: 0.9, reason: 'wartości wyglądają jak adresy e-mail' }
  if (share(values, (value) => HAS_POSTCODE.test(value)) >= 0.6) return { target: 'adres', confidence: 0.9, reason: 'pełny adres z kodem pocztowym i miejscowością w jednej komórce' }
  return null
}

function fromHeader(header: string): Evidence | null {
  if (header === GEO_LAT) return { target: 'szerokosc_geograficzna', confidence: 1, reason: 'położenie z geometrii obiektu' }
  if (header === GEO_LON) return { target: 'dlugosc_geograficzna', confidence: 1, reason: 'położenie z geometrii obiektu' }
  const key = headerKey(header)
  const exact = SYNONYMS.get(key)
  if (exact) return { target: exact, confidence: 0.8, reason: 'nazwa kolumny' }
  // "szerokosc geograficzna wgs84", "telefon do portierni": the longest synonym the header starts with or contains.
  let best: { target: MappingTarget; length: number } | null = null
  for (const [synonym, target] of SYNONYMS) {
    if (synonym.length < 4 || !(` ${key} `.includes(` ${synonym} `))) continue
    if (!best || synonym.length > best.length) best = { target, length: synonym.length }
  }
  return best ? { target: best.target, confidence: 0.6, reason: 'nazwa kolumny (częściowe dopasowanie)' } : null
}

export function suggestMapping(table: RawTable): ColumnSuggestion[] {
  const rows = table.rows.slice(0, 500)
  const suggestions = table.headers.map((header): ColumnSuggestion => {
    const values = rows.map((row) => row[header] ?? '').filter((value) => value !== '')
    const distinct = new Set(values)
    const samples = [...distinct].slice(0, 3)
    const byValues = fromValues(values)
    const byHeader = fromHeader(header)

    let evidence: Evidence
    // An empty column whose header names a field stays mapped: a file made from the template keeps its shape.
    if (values.length === 0) evidence = byHeader ? { ...byHeader, reason: `${byHeader.reason}; kolumna jest pusta` } : { target: null, confidence: 0.9, reason: 'kolumna jest pusta' }
    else if (byValues && byHeader && byValues.target === byHeader.target) evidence = { ...byValues, confidence: 0.98, reason: `${byHeader.reason} i ${byValues.reason}` }
    else if (byValues && byHeader?.confidence !== 1) {
      const contradicts = byHeader && byHeader.target !== byValues.target
      evidence = contradicts ? { ...byValues, confidence: 0.85, reason: `${byValues.reason}, choć nazwa kolumny wskazuje na pole ${byHeader.target}` } : byValues
    } else if (byHeader) evidence = byHeader
    else if (share(values, (value) => PHONE.test(value) && value.replace(/\D/g, '').length >= 9) >= 0.8) evidence = { target: 'telefon_kontaktowy', confidence: 0.7, reason: 'wartości wyglądają jak numery telefonów' }
    else evidence = { target: null, confidence: 0.5, reason: 'nie rozpoznano; wybierz pole z listy albo pomiń kolumnę' }

    // "Nazwa" = "Defibrylator" in every row is a label, not the name of the place.
    if (evidence.target && distinct.size === 1 && rows.length >= 3 && !CONSTANT_OK.has(evidence.target) && byHeader?.confidence !== 1) {
      evidence = { target: null, confidence: 0.8, reason: `ta sama wartość („${samples[0]}") w każdym wierszu` }
    }
    return { header, ...evidence, samples }
  })

  // A field can come from one column only: the strongest claim keeps it.
  const taken = new Map<MappingTarget, ColumnSuggestion>()
  for (const suggestion of [...suggestions].sort((a, b) => b.confidence - a.confidence)) {
    if (!suggestion.target) continue
    const holder = taken.get(suggestion.target)
    if (!holder) taken.set(suggestion.target, suggestion)
    else {
      suggestion.reason = `pole ${suggestion.target} lepiej pasuje do kolumny „${holder.header}"`
      suggestion.target = null
      suggestion.confidence = 0.5
    }
  }

  // No name column: a descriptive column with a different value in each row is the name of the place.
  if (!taken.has('nazwa')) {
    const candidate = suggestions
      .filter((suggestion) => suggestion.target === 'opis_lokalizacji' || suggestion.target === null)
      .map((suggestion) => {
        const values = rows.map((row) => row[suggestion.header] ?? '').filter((value) => value !== '')
        const textual = share(values, (value) => /\p{L}{3,}/u.test(value) && !EMAIL.test(value))
        return { suggestion, score: values.length === 0 ? 0 : (new Set(values).size / values.length) * textual * (suggestion.target === 'opis_lokalizacji' ? 1.2 : 1) }
      })
      .sort((a, b) => b.score - a.score)[0]
    if (candidate && candidate.score >= 0.5) {
      candidate.suggestion.target = 'nazwa'
      candidate.suggestion.confidence = 0.6
      candidate.suggestion.reason = 'brak osobnej kolumny z nazwą miejsca; ta kolumna ma inną wartość w każdym wierszu'
    }
  }
  return suggestions
}

export const toMapping = (suggestions: ColumnSuggestion[]): Record<string, MappingTarget | null> =>
  Object.fromEntries(suggestions.map((suggestion) => [suggestion.header, suggestion.target]))
