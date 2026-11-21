/**
 * Sources of AED data that we know of and do not merge into the national dataset, with the reason.
 * They are listed next to the merged sources, so that the picture of "who holds the data" is complete.
 * Figures as checked on 21 November 2026.
 */
export interface KnownSource {
  id: string
  name: string
  url: string
  /** null when the source states no licence. */
  licence: string | null
  /** Devices according to the source itself; null when unknown. */
  devices: number | null
  /** What is known about the fields the source holds. */
  scope: string
  reason: string
}

export const KNOWN_SOURCES: KnownSource[] = [
  {
    id: 'um-lodz',
    name: 'Urząd Miasta Łodzi: lokalizacje defibrylatorów AED',
    url: 'https://uml.lodz.pl/dla-mieszkancow/zdrowie/mapa-defibrylatorow-aed/',
    licence: null,
    devices: 140,
    scope:
      'Arkusz Excela (.xls) ze 140 wierszami: podmiot, obiekt, adres, miejsce w obiekcie i godziny dostępu. Bez współrzędnych. Strona urzędu mówi o 136 urządzeniach stałych i 10 mobilnych; ostatnia aktualizacja: sierpień 2026.',
    reason:
      'Urząd nie podał, na jakich warunkach wolno wykorzystać te dane ponownie. Plik da się wczytać kreatorem (dla 118 ze 140 wierszy system ustala położenie z adresu), ale do zbioru wejdzie dopiero wtedy, gdy urząd zgłosi go sam albo potwierdzi warunki.',
  },
  {
    id: 'um-krakow',
    name: 'Urząd Miasta Krakowa: Krakowski Impuls Życia AED',
    url: 'https://krakow.pl/3992,artykul,gdzie-znalezc-defibrylator-.html',
    licence: null,
    devices: null,
    scope: 'Wykaz na stronie miasta, stan na 1 października 2026: nazwa miejsca i adres. Bez współrzędnych.',
    reason: 'Wykaz jest stroną internetową, a nie plikiem, i nie ma przy nim informacji o licencji. Urząd może zgłosić go kreatorem jako zwykły arkusz.',
  },
  {
    id: 'um-gliwice',
    name: 'Geoportal Gliwic: mapa defibrylatorów',
    url: 'https://geoportal.gliwice.eu/gpt4/',
    licence: null,
    devices: null,
    scope: 'Zakres pól nieznany. 24 urządzenia w OpenStreetMap podają tę mapę jako swoje źródło.',
    reason: 'Dane są dostępne tylko w przeglądarce mapy. Nie znaleźliśmy pliku do pobrania ani informacji o licencji.',
  },
  {
    id: 'ratujzsercem',
    name: 'ratujzsercem.pl',
    url: 'https://ratujzsercem.pl',
    licence: null,
    devices: 3149,
    scope: 'Szczegóły urządzeń są dostępne tylko jako strony HTML; dane od dawna nie były aktualizowane.',
    reason: 'Nie znaleźliśmy informacji o licencji, więc nie możemy tych danych ponownie udostępnić. Służą najwyżej jako wskazówka, kogo poprosić o zgłoszenie.',
  },
]
