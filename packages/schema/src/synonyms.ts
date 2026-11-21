/**
 * Column header → field of the pattern, for files that were not made from our template.
 * Keys are headers after `headerKey()`: lower case, no diacritics, punctuation as single spaces.
 *
 * Besides real fields a column can be one of three composites that the importer splits itself:
 *   adres         a whole address in one cell ("ul. Jasna 3, 38-400 Krosno")
 *   ulica         street with its number ("Piłsudskiego 41")
 *   wspolrzedne   both coordinates in one cell ("52.32, 21.10")
 */
import type { AedFieldName } from './fields'

export type MappingTarget = AedFieldName | 'adres' | 'ulica' | 'wspolrzedne'

export const COMPOSITE_TARGETS = ['adres', 'ulica', 'wspolrzedne'] as const

const COMPOSITE_FIELDS: Record<(typeof COMPOSITE_TARGETS)[number], AedFieldName[]> = {
  adres: ['cecha_ulicy', 'nazwa_ulicy', 'nr_budynku', 'kod_pocztowy', 'miejscowosc'],
  ulica: ['cecha_ulicy', 'nazwa_ulicy', 'nr_budynku'],
  wspolrzedne: ['szerokosc_geograficzna', 'dlugosc_geograficzna'],
}

/** The pattern fields a mapped column can fill: itself, or the parts of a composite. */
export const targetFields = (target: MappingTarget): AedFieldName[] => (target in COMPOSITE_FIELDS ? COMPOSITE_FIELDS[target as keyof typeof COMPOSITE_FIELDS] : [target as AedFieldName])

/** Normalises a header so that "Szerokość geograficzna", " szerokosc_geograficzna" and "SZEROKOŚĆ GEOGR." meet. */
export function headerKey(header: string): string {
  return header
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const table: Record<MappingTarget, string[]> = {
  id: [],
  nazwa: ['nazwa', 'nazwa miejsca', 'nazwa obiektu', 'obiekt', 'miejsce', 'name', 'nazwa lokalizacji', 'instytucja', 'placowka'],
  cecha_ulicy: ['cecha ulicy', 'cecha', 'typ ulicy'],
  nazwa_ulicy: ['nazwa ulicy', 'street'],
  nr_budynku: ['nr budynku', 'numer budynku', 'nr domu', 'numer domu', 'home number', 'housenumber', 'house number', 'numer', 'nr'],
  nr_lokalu: ['nr lokalu', 'numer lokalu', 'lokal'],
  kod_pocztowy: ['kod pocztowy', 'kod', 'postcode', 'postal code', 'zip'],
  miejscowosc: ['miejscowosc', 'miasto', 'city', 'gmina', 'town'],
  kod_terc: ['kod terc', 'terc', 'teryt', 'kod teryt', 'teryt gminy'],
  kod_simc: ['kod simc', 'simc'],
  szerokosc_geograficzna: ['szerokosc geograficzna', 'szerokosc', 'szer geogr', 'szer', 'lat', 'latitude', 'y', 'wsp y', 'n'],
  dlugosc_geograficzna: ['dlugosc geograficzna', 'dlugosc', 'dl geogr', 'dl', 'lon', 'lng', 'long', 'longitude', 'x', 'wsp x', 'e'],
  opis_lokalizacji: [
    'opis lokalizacji',
    'lokalizacja',
    'umiejscowienie',
    'opis',
    'miejsce w budynku',
    'dokladna lokalizacja',
    'location',
    'description',
    'gdzie',
    'usytuowanie',
  ],
  wewnatrz_budynku: ['wewnatrz budynku', 'wewnatrz', 'indoor', 'w budynku'],
  pietro: ['pietro', 'kondygnacja', 'level', 'poziom'],
  dostep: ['dostep', 'dostepnosc', 'access', 'rodzaj dostepu'],
  godziny_dostepnosci: [
    'godziny dostepnosci',
    'godziny otwarcia',
    'godziny',
    'dostepnosc godzinowa',
    'opening hours',
    'czas dostepnosci',
    'godziny pracy',
  ],
  uwagi_dostepu: ['uwagi dostepu', 'uwagi', 'jak sie dostac', 'informacje dodatkowe'],
  podmiot_odpowiedzialny: ['podmiot odpowiedzialny', 'operator', 'wlasciciel', 'administrator', 'opiekun', 'zarzadca', 'podmiot', 'dysponent'],
  telefon_kontaktowy: ['telefon kontaktowy', 'telefon', 'tel', 'phone', 'nr telefonu', 'numer telefonu', 'kontakt'],
  email_kontaktowy: ['email kontaktowy', 'email', 'e mail', 'mail', 'poczta elektroniczna', 'adres e mail'],
  status: ['status', 'stan', 'sprawny'],
  data_weryfikacji: ['data weryfikacji', 'data przegladu', 'data ostatniego przegladu', 'data kontroli', 'check date', 'ostatni przeglad'],
  producent: ['producent', 'manufacturer', 'marka'],
  model: ['model', 'typ urzadzenia'],
  elektrody_pediatryczne: ['elektrody pediatryczne', 'elektrody dla dzieci', 'tryb pediatryczny'],
  termin_waznosci_elektrod: ['termin waznosci elektrod', 'waznosc elektrod', 'elektrody wazne do'],
  termin_waznosci_baterii: ['termin waznosci baterii', 'waznosc baterii', 'bateria wazna do'],
  zrodlo: [],
  id_w_zrodle: ['id w zrodle', 'numer id', 'id', 'lp', 'l p', 'nr inwentarzowy', 'numer inwentarzowy', 'identyfikator', 'numer urzadzenia'],
  licencja: [],
  data_aktualizacji: [],
  adres: ['adres', 'address', 'adres obiektu', 'adres lokalizacji'],
  ulica: ['ulica', 'ulica i numer', 'ulica nr'],
  wspolrzedne: ['wspolrzedne', 'wspolrzedne geograficzne', 'wspolrzedne gps', 'gps', 'geometry', 'coordinates', 'lokalizacja gps'],
}

/** header key → target. A key listed under two targets is a bug; the first one wins. */
export const SYNONYMS: ReadonlyMap<string, MappingTarget> = (() => {
  const map = new Map<string, MappingTarget>()
  for (const [target, keys] of Object.entries(table) as [MappingTarget, string[]][]) {
    for (const key of [headerKey(target.replaceAll('_', ' ')), ...keys]) {
      if (!map.has(key)) map.set(key, target)
    }
  }
  return map
})()
