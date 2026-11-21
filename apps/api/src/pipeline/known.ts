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
    id: 'ratujzsercem',
    name: 'ratujzsercem.pl',
    url: 'https://ratujzsercem.pl',
    licence: null,
    devices: 3149,
    scope: 'Szczegóły urządzeń są dostępne tylko jako strony HTML; dane od dawna nie były aktualizowane.',
    reason: 'Nie znaleźliśmy informacji o licencji, więc nie możemy tych danych ponownie udostępnić. Służą najwyżej jako wskazówka, kogo poprosić o zgłoszenie.',
  },
]
