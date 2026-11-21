/**
 * Wzorzec danych AED: the one catalogue of fields every other artefact is generated from
 * (Table Schema, CSV template, field documentation, API schema, form validation, column mapping).
 *
 * Column names are Polish snake_case, as in existing dane.gov.pl datasets. The address core
 * (cecha_ulicy … dlugosc_geograficzna) is identical to the AED file Legionowo already publishes,
 * so that file conforms as it is.
 *
 * Requirement levels:
 *   required     always present in the national file
 *   recommended  required from an owner who submits a device; may be empty in records imported
 *                from older municipal files that never collected it (the quality score shows it)
 *   optional     nice to have
 */

export const GROUPS = [
  { id: 'identyfikacja', title: 'Identyfikacja' },
  { id: 'polozenie', title: 'Adres i położenie' },
  { id: 'umiejscowienie', title: 'Umiejscowienie w obiekcie' },
  { id: 'dostepnosc', title: 'Dostępność' },
  { id: 'opiekun', title: 'Opiekun urządzenia' },
  { id: 'stan', title: 'Stan' },
  { id: 'urzadzenie', title: 'Urządzenie' },
  { id: 'pochodzenie', title: 'Pochodzenie danych' },
] as const

export type GroupId = (typeof GROUPS)[number]['id']
export type FieldType = 'string' | 'number' | 'boolean' | 'date'
export type Requirement = 'required' | 'recommended' | 'optional'

export interface FieldDef {
  name: string
  group: GroupId
  type: FieldType
  requirement: Requirement
  /** Short Polish label for forms and tables. */
  title: string
  /** What the field means and how to fill it, for a clerk who is not an IT person. */
  description: string
  example: string | number | boolean
  enum?: readonly string[]
  /** Meaning of each enum value, in the order of `enum`. */
  enumLabels?: readonly string[]
  pattern?: string
  minimum?: number
  maximum?: number
  maxLength?: number
  /** Matching OpenStreetMap tag (emergency=defibrillator). */
  osm?: string
  /** Matching field of the French national AED database (Géo'DAE, schema-dae). */
  geoDae?: string
  /** Role in dane.gov.pl's map view of a tabular resource: label, b = latitude, l = longitude. */
  portalGeoRole?: 'label' | 'b' | 'l'
}

/** Bounding box of Poland with a small margin; also used to recognise coordinate columns and swapped values. */
export const POLAND = { minLat: 49.0, maxLat: 54.9, minLon: 14.1, maxLon: 24.2 } as const

export const ACCESS = ['publiczny', 'ograniczony', 'prywatny'] as const
/**
 * `nazwa` of a device whose source names no place (most of OpenStreetMap). Whoever shows the record
 * should call it by its address instead.
 */
export const UNNAMED_PLACE = 'Defibrylator AED'

export const STATUS = ['czynny', 'czasowo_niedostepny', 'wycofany', 'nieznany'] as const
export const LICENCES = ['CC0 1.0', 'CC BY 4.0', 'ODbL 1.0'] as const

export const FIELDS = [
  // ------------------------------------------------------------ identyfikacja
  {
    name: 'id',
    group: 'identyfikacja',
    type: 'string',
    requirement: 'required',
    title: 'Identyfikator',
    description:
      'Stały identyfikator urządzenia w zbiorze krajowym (UUID). Nadaje go system; nie zmienia się przy aktualizacji danych, więc można się na niego powoływać.',
    example: '0b6f6a52-6f1e-5c0e-9d0a-3f1f0c9e7a11',
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  },
  {
    name: 'nazwa',
    group: 'identyfikacja',
    type: 'string',
    requirement: 'required',
    title: 'Nazwa miejsca',
    description: 'Nazwa obiektu, w którym jest urządzenie – taka, po której trafi tam osoba z zewnątrz.',
    example: 'Urząd Miasta Legionowo',
    maxLength: 200,
    geoDae: 'nom',
    portalGeoRole: 'label',
  },

  // ---------------------------------------------------------------- położenie
  {
    name: 'cecha_ulicy',
    group: 'polozenie',
    type: 'string',
    requirement: 'optional',
    title: 'Cecha ulicy',
    description: 'Rodzaj ulicy według rejestru TERYT, małymi literami: ulica, aleja, plac, osiedle, rondo itd.',
    example: 'ulica',
    maxLength: 30,
  },
  {
    name: 'nazwa_ulicy',
    group: 'polozenie',
    type: 'string',
    requirement: 'optional',
    title: 'Nazwa ulicy',
    description: 'Nazwa ulicy bez cechy („Piłsudskiego", nie „ul. Piłsudskiego"). Puste, jeśli miejscowość nie ma ulic.',
    example: 'Piłsudskiego',
    maxLength: 120,
    osm: 'addr:street',
    geoDae: 'adr_voie',
  },
  {
    name: 'nr_budynku',
    group: 'polozenie',
    type: 'string',
    requirement: 'optional',
    title: 'Numer budynku',
    description: 'Numer porządkowy budynku, razem z literą, jeśli ją ma.',
    example: '41',
    maxLength: 20,
    osm: 'addr:housenumber',
    geoDae: 'adr_num',
  },
  {
    name: 'nr_lokalu',
    group: 'polozenie',
    type: 'string',
    requirement: 'optional',
    title: 'Numer lokalu',
    description: 'Numer lokalu, jeśli urządzenie jest w wydzielonym lokalu.',
    example: '2',
    maxLength: 20,
  },
  {
    name: 'kod_pocztowy',
    group: 'polozenie',
    type: 'string',
    requirement: 'optional',
    title: 'Kod pocztowy',
    description: 'Kod pocztowy w zapisie 00-000.',
    example: '05-120',
    pattern: '^\\d{2}-\\d{3}$',
    osm: 'addr:postcode',
    geoDae: 'com_cp',
  },
  {
    name: 'miejscowosc',
    group: 'polozenie',
    type: 'string',
    requirement: 'required',
    title: 'Miejscowość',
    description: 'Nazwa miejscowości.',
    example: 'Legionowo',
    maxLength: 80,
    osm: 'addr:city',
    geoDae: 'com_nom',
  },
  {
    name: 'kod_terc',
    group: 'polozenie',
    type: 'string',
    requirement: 'required',
    title: 'Kod TERC gminy',
    description:
      'Identyfikator gminy w rejestrze TERYT (TERC), 7 cyfr: województwo, powiat, gmina i rodzaj gminy. System uzupełnia go sam na podstawie współrzędnych.',
    example: '1408011',
    pattern: '^\\d{7}$',
    geoDae: 'com_insee',
  },
  {
    name: 'kod_simc',
    group: 'polozenie',
    type: 'string',
    requirement: 'optional',
    title: 'Kod SIMC miejscowości',
    description: 'Identyfikator miejscowości w rejestrze TERYT (SIMC), 7 cyfr.',
    example: '0920806',
    pattern: '^\\d{7}$',
  },
  {
    name: 'szerokosc_geograficzna',
    group: 'polozenie',
    type: 'number',
    requirement: 'required',
    title: 'Szerokość geograficzna',
    description: 'Szerokość geograficzna w układzie WGS84, w stopniach dziesiętnych z kropką. W Polsce od 49,0 do 54,9.',
    example: 52.395198,
    minimum: POLAND.minLat,
    maximum: POLAND.maxLat,
    geoDae: 'lat_coor1',
    portalGeoRole: 'b',
  },
  {
    name: 'dlugosc_geograficzna',
    group: 'polozenie',
    type: 'number',
    requirement: 'required',
    title: 'Długość geograficzna',
    description: 'Długość geograficzna w układzie WGS84, w stopniach dziesiętnych z kropką. W Polsce od 14,1 do 24,2.',
    example: 20.931382,
    minimum: POLAND.minLon,
    maximum: POLAND.maxLon,
    geoDae: 'long_coor1',
    portalGeoRole: 'l',
  },

  // ----------------------------------------------------------- umiejscowienie
  {
    name: 'opis_lokalizacji',
    group: 'umiejscowienie',
    type: 'string',
    requirement: 'recommended',
    title: 'Gdzie dokładnie',
    description:
      'Gdzie dokładnie jest urządzenie: wejście, pomieszczenie, punkt orientacyjny. To zdanie przeczyta osoba, która biegnie po defibrylator.',
    example: 'Parter, hol główny, na ścianie obok portierni',
    maxLength: 300,
    osm: 'defibrillator:location',
    geoDae: 'acc_complt',
  },
  {
    name: 'wewnatrz_budynku',
    group: 'umiejscowienie',
    type: 'boolean',
    requirement: 'optional',
    title: 'Wewnątrz budynku',
    description: 'true, jeśli urządzenie jest w środku budynku; false, jeśli na zewnątrz (np. w kapsule na elewacji).',
    example: true,
    osm: 'indoor',
    geoDae: 'acc',
  },
  {
    name: 'pietro',
    group: 'umiejscowienie',
    type: 'string',
    requirement: 'optional',
    title: 'Piętro',
    description: 'Numer kondygnacji: 0 to parter, -1 to pierwsza kondygnacja podziemna.',
    example: '0',
    maxLength: 10,
    osm: 'level',
    geoDae: 'acc_etg',
  },

  // --------------------------------------------------------------- dostępność
  {
    name: 'dostep',
    group: 'dostepnosc',
    type: 'string',
    requirement: 'recommended',
    title: 'Kto może skorzystać',
    description: 'Kto ma dostęp do urządzenia.',
    example: 'publiczny',
    enum: ACCESS,
    enumLabels: [
      'każdy może po nie sięgnąć w godzinach dostępności',
      'dostęp przez personel lub tylko dla klientów i gości obiektu',
      'wyłącznie dla pracowników lub mieszkańców, bez dostępu z zewnątrz',
    ],
    osm: 'access',
    geoDae: 'acc_lib',
  },
  {
    name: 'godziny_dostepnosci',
    group: 'dostepnosc',
    type: 'string',
    requirement: 'recommended',
    title: 'Godziny dostępności',
    description:
      'Kiedy można dostać się do urządzenia, w zapisie opening_hours znanym z OpenStreetMap: „24/7" przez całą dobę, „Mo-Fr 08:00-16:00" od poniedziałku do piątku, „Mo-Fr 07:30-15:30; Sa 08:00-12:00" dla różnych dni. Kreator układa ten zapis z wybranych dni i godzin.',
    example: 'Mo-Fr 08:00-16:00',
    maxLength: 200,
    osm: 'opening_hours',
    geoDae: 'dispo_horaires',
  },
  {
    name: 'uwagi_dostepu',
    group: 'dostepnosc',
    type: 'string',
    requirement: 'optional',
    title: 'Jak się dostać',
    description: 'Co trzeba zrobić, żeby dostać się do urządzenia: domofon, portier, szafka z plombą. Nie wpisuj tu kodów dostępu.',
    example: 'Po godzinach pracy urzędu dzwonić domofonem do ochrony',
    maxLength: 300,
    geoDae: 'disp_complt',
  },

  // ------------------------------------------------------------------ opiekun
  {
    name: 'podmiot_odpowiedzialny',
    group: 'opiekun',
    type: 'string',
    requirement: 'recommended',
    title: 'Podmiot odpowiedzialny',
    description: 'Instytucja lub firma, która opiekuje się urządzeniem i potwierdza jego sprawność.',
    example: 'Urząd Miasta Legionowo',
    maxLength: 200,
    osm: 'operator',
    geoDae: 'expt_rais',
  },
  {
    name: 'telefon_kontaktowy',
    group: 'opiekun',
    type: 'string',
    requirement: 'optional',
    title: 'Telefon kontaktowy',
    description: 'Numer telefonu instytucji (nie prywatny), pod którym ktoś pomoże dotrzeć do urządzenia. Zapis: +48 i dziewięć cyfr.',
    example: '+48227667200',
    pattern: '^\\+\\d{9,15}$',
    osm: 'phone',
    geoDae: 'tel1',
  },
  {
    name: 'email_kontaktowy',
    group: 'opiekun',
    type: 'string',
    requirement: 'optional',
    title: 'E-mail kontaktowy',
    description: 'Adres e-mail instytucji (nie imienny), na który trafi prośba o potwierdzenie danych.',
    example: 'kancelaria@um.legionowo.pl',
    maxLength: 120,
    geoDae: 'expt_email',
  },

  // --------------------------------------------------------------------- stan
  {
    name: 'status',
    group: 'stan',
    type: 'string',
    requirement: 'required',
    title: 'Status',
    description: 'Czy z urządzenia można dziś skorzystać.',
    example: 'czynny',
    enum: STATUS,
    enumLabels: [
      'na miejscu i sprawne',
      'chwilowo niedostępne, np. serwis albo remont obiektu',
      'trwale usunięte z tej lokalizacji',
      'opiekun nie potwierdził stanu',
    ],
    geoDae: 'etat_fonct',
  },
  {
    name: 'data_weryfikacji',
    group: 'stan',
    type: 'date',
    requirement: 'recommended',
    title: 'Data weryfikacji',
    description: 'Dzień, w którym opiekun ostatnio potwierdził, że urządzenie jest na miejscu i sprawne (RRRR-MM-DD).',
    example: '2026-10-01',
    osm: 'check_date',
    geoDae: 'dermnt',
  },

  // --------------------------------------------------------------- urządzenie
  {
    name: 'producent',
    group: 'urzadzenie',
    type: 'string',
    requirement: 'optional',
    title: 'Producent',
    description: 'Producent urządzenia.',
    example: 'Philips',
    maxLength: 80,
    osm: 'manufacturer',
    geoDae: 'fab_rais',
  },
  {
    name: 'model',
    group: 'urzadzenie',
    type: 'string',
    requirement: 'optional',
    title: 'Model',
    description: 'Model urządzenia.',
    example: 'HeartStart FRx',
    maxLength: 80,
    osm: 'model',
    geoDae: 'modele',
  },
  {
    name: 'elektrody_pediatryczne',
    group: 'urzadzenie',
    type: 'boolean',
    requirement: 'optional',
    title: 'Elektrody pediatryczne',
    description: 'true, jeśli przy urządzeniu są elektrody dla dzieci albo ma ono tryb pediatryczny.',
    example: false,
    geoDae: 'lc_ped',
  },
  {
    name: 'termin_waznosci_elektrod',
    group: 'urzadzenie',
    type: 'date',
    requirement: 'optional',
    title: 'Termin ważności elektrod',
    description: 'Data, do której ważne są elektrody dla dorosłych (RRRR-MM-DD). Pozwala systemowi przypomnieć opiekunowi o wymianie.',
    example: '2027-06-30',
    geoDae: 'dtpr_lcad',
  },
  {
    name: 'termin_waznosci_elektrod_pediatrycznych',
    group: 'urzadzenie',
    type: 'date',
    requirement: 'optional',
    title: 'Termin ważności elektrod pediatrycznych',
    description: 'Data, do której ważne są elektrody dla dzieci (RRRR-MM-DD). Zostaw puste, gdy przy urządzeniu nie ma takich elektrod.',
    example: '2027-03-31',
    geoDae: 'dtpr_lcped',
  },
  {
    name: 'termin_waznosci_baterii',
    group: 'urzadzenie',
    type: 'date',
    requirement: 'optional',
    title: 'Termin ważności baterii',
    description: 'Data, do której ważna jest bateria (RRRR-MM-DD).',
    example: '2028-01-31',
    geoDae: 'dtpr_bat',
  },

  // -------------------------------------------------------------- pochodzenie
  {
    name: 'zrodlo',
    group: 'pochodzenie',
    type: 'string',
    requirement: 'required',
    title: 'Źródło',
    description: 'Dostawca lub zbiór, z którego pochodzi rekord. Przy licencji CC BY 4.0 jest to zarazem wymagane oznaczenie autorstwa.',
    example: 'Urząd Miasta Legionowo (dane.gov.pl, zbiór 40593)',
    maxLength: 300,
  },
  {
    name: 'id_w_zrodle',
    group: 'pochodzenie',
    type: 'string',
    requirement: 'optional',
    title: 'Identyfikator w źródle',
    description: 'Identyfikator, pod którym urządzenie występuje u dostawcy (np. numer inwentarzowy albo numer z pliku).',
    example: '12',
    maxLength: 100,
  },
  {
    name: 'licencja',
    group: 'pochodzenie',
    type: 'string',
    requirement: 'required',
    title: 'Licencja',
    description: 'Licencja, na której dostawca udostępnił rekord.',
    example: 'CC0 1.0',
    enum: LICENCES,
  },
  {
    name: 'data_aktualizacji',
    group: 'pochodzenie',
    type: 'date',
    requirement: 'required',
    title: 'Data aktualizacji',
    description: 'Dzień ostatniej zmiany rekordu w zbiorze krajowym (RRRR-MM-DD).',
    example: '2026-11-21',
  },
] as const satisfies readonly FieldDef[]

type Field = (typeof FIELDS)[number]
type ValueOf<F> = F extends { enum: readonly (infer E)[] }
  ? E
  : F extends { type: 'number' }
    ? number
    : F extends { type: 'boolean' }
      ? boolean
      : string

/** One AED in the national dataset. Required fields are never null; everything else may be. */
export type AedRecord = {
  [F in Field as F['name']]: F extends { requirement: 'required' } ? ValueOf<F> : ValueOf<F> | null
}

export type AedFieldName = Field['name']
export type Access = (typeof ACCESS)[number]
export type Status = (typeof STATUS)[number]
export type Licence = (typeof LICENCES)[number]

/** Columns the system fills in on its own; a provider leaves them empty. */
export const SYSTEM_FIELDS = ['id', 'zrodlo', 'licencja', 'data_aktualizacji'] as const satisfies readonly AedFieldName[]

/** What a source or an owner can tell us about a device: any subset of the fields, before the system adds its own. */
export type AedInput = Partial<Omit<AedRecord, (typeof SYSTEM_FIELDS)[number]>>

export const FIELD_NAMES: readonly AedFieldName[] = FIELDS.map((field) => field.name)

/** The fields a source can deliver: the pattern without the system's own columns. */
export const INPUT_FIELD_NAMES = FIELD_NAMES.filter((name) => !(SYSTEM_FIELDS as readonly string[]).includes(name)) as readonly (keyof AedInput)[]

export const fieldByName = (name: string): FieldDef | undefined => (FIELDS as readonly FieldDef[]).find((field) => field.name === name)
