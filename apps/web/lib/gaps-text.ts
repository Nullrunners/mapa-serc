import type { GapsMethod, GapsNearbyDevice, GapsPlace, GapsTotals, GapsView } from "@/lib/api/client";
import { distance } from "@/lib/format";

/** Words for the analysis of gaps in AED cover: numbers of people, places, conclusions and the ready justification. */

/** Polish has three forms after a number: 1 miejsce, 2 miejsca, 5 miejsc (and 22 miejsca, 12 miejsc). */
export function plural(value: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.round(value));
  if (n === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
}

/** "37092675" → "37,1 mln", "9355" → "ok. 9400"; small numbers stay exact. */
export const people = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln`
    : value >= 1000
      ? `ok. ${(Math.round(value / 100) * 100).toLocaleString("pl-PL")}`
      : value.toLocaleString("pl-PL");

/**
 * "ok. 9400 osób", "3 osoby"; `object` for the form after a verb ("obejmie 1 osobę"). The form follows the number as
 * shown: from a thousand on it is rounded to hundreds ("ok. 8500"), which always takes "osób".
 */
export const persons = (value: number, object = false) => `${people(value)} ${plural(value >= 1000 ? 1000 : value, object ? "osobę" : "osoba", "osoby", "osób")}`;

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** "73% mieszkańców"; nothing when there is no one to count. */
export const share = (part: number, whole: number) => (whole > 0 ? `${percent(part, whole)}% mieszkańców` : "");

/** "24 km²", "0,8 km²". */
export const km2 = (value: number) => `${value >= 10 ? Math.round(value).toLocaleString("pl-PL") : value.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} km²`;

/** The register says "powiat Warszawa"; we write "powiat" ourselves. */
export const county = (name: string) => name.replace(/^powiat\s+/i, "");

const point = (place: GapsPlace) => `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;

/** "Warszawa (miasto)" → "Warszawa", to stand in brackets itself. */
const communeOnly = (gmina: string) => gmina.replace(/\s*\(.*\)\s*$/, "");

export const placeName = (place: GapsPlace) => place.address ?? (place.commune ? `okolice punktu ${point(place)} (${communeOnly(place.commune.gmina)})` : `okolice punktu ${point(place)}`);

/** Why a device near the place counts (or not) for the analysis. */
export const BASIS: Record<GapsNearbyDevice["basis"], string> = {
  hours: "Godziny podane w danych",
  outdoor: "Na zewnątrz, godzin brak: liczymy całą dobę",
  assumed: "Godzin brak: przyjęliśmy dni robocze 8–16",
  excluded: "Tylko dla personelu albo niedostępne: nie liczymy",
};

export const coverageNow = (hoursPerWeek: number, reachM: number) =>
  hoursPerWeek === 0 ? `brak defibrylatora w promieniu ${reachM} m` : hoursPerWeek === 168 ? "defibrylator w pobliżu dostępny całą dobę" : `defibrylator w pobliżu dostępny przez ${hoursPerWeek} ze 168 godzin tygodnia`;

/**
 * The few sentences worth reading first about an analysed area: how many have no device near, how the night compares,
 * how many hours of the week are covered, and what the recommended places would change. All from the figures shown.
 */
export function conclusions({ totals, places, method }: GapsView, poland: GapsTotals | null): string[] {
  const { residents, noDevice, noNight, coveredShare } = totals;
  if (residents === 0) return ["Według spisu powszechnego 2021 na tym obszarze nikt nie mieszka."];
  const lines: string[] = [];

  if (noDevice === 0) lines.push(`Każdy mieszkaniec ma w promieniu ${method.reachM} m przynajmniej jeden znany defibrylator.`);
  else {
    const here = percent(noDevice, residents);
    const country = poland && poland.residents > 0 ? percent(poland.noDevice, poland.residents) : null;
    const against =
      country === null ? "." : here > country + 2 ? `. To więcej niż średnio w Polsce (${country}%).` : here < country - 2 ? `. To mniej niż średnio w Polsce (${country}%).` : `, podobnie jak średnio w Polsce (${country}%).`;
    lines.push(`${here}% mieszkańców (${persons(noDevice)}) nie ma żadnego znanego defibrylatora w promieniu ${method.reachM} m${against}`);
  }
  if (noNight > noDevice) lines.push(`W nocy jest gorzej: bez dostępnego defibrylatora zostaje ${percent(noNight, residents)}% mieszkańców, bo wiele urządzeń stoi w budynkach, które są wtedy zamknięte.`);
  lines.push(`Przeciętny mieszkaniec ma defibrylator w zasięgu przez ${Math.round(coveredShare * 168)} ze 168 godzin tygodnia.`);

  if (places.length > 0) {
    const gained = places.reduce((sum, place) => sum + place.gained.residents, 0);
    const night = places.reduce((sum, place) => sum + place.gained.noNight, 0);
    const where = places.length === 1 ? "Defibrylator dostępny całą dobę w polecanym miejscu objąłby" : `Defibrylatory dostępne całą dobę w ${places.length} polecanych miejscach objęłyby`;
    const fewer =
      noNight > 0 && night >= noNight
        ? " Wtedy nikt na tym obszarze nie zostałby w nocy bez defibrylatora w pobliżu."
        : noNight > 0 && night > 0
          ? ` Liczba osób bez AED dostępnego w nocy spadłaby o ${percent(night, noNight)}%.`
          : "";
    lines.push(`${where} ${persons(gained, true)}, które dziś nie mają takiego w pobliżu.${fewer}`);
    const [best] = places;
    if (places.length > 1 && best) lines.push(`Najwięcej osób, ${people(best.gained.residents)}, obejmie miejsce nr 1: ${placeName(best)}.`);
  }
  return lines;
}

/** The paragraph a resident can paste into a participatory budget application. */
export function justification(place: GapsPlace, method: GapsMethod): string {
  const where = place.address ? `w okolicy adresu ${place.address}` : `w okolicy punktu ${point(place)}`;
  const commune = place.commune ? ` (gmina ${place.commune.gmina}, powiat ${county(place.commune.powiat)}, województwo ${place.commune.wojewodztwo})` : "";
  const lines = [
    `Proponujemy zakup i montaż defibrylatora AED dostępnego całą dobę (w zewnętrznej, ogrzewanej szafce) ${where}${commune}.`,
    `W promieniu ${method.reachM} m od tego miejsca mieszka ${people(place.inReach.residents)} osób, w tym ${people(place.inReach.seniors)} w wieku 65 lat i więcej (Narodowy Spis Powszechny 2021).`,
  ];
  if (place.gained.noDevice > 0) lines.push(`Według znanych danych ${people(place.gained.noDevice)} z nich nie ma dziś w tej odległości żadnego defibrylatora.`);
  if (place.gained.noNight > 0) lines.push(`W nocy w pobliżu nie ma dostępnego defibrylatora dla ${people(place.gained.noNight)} osób.`);
  if (place.nearestAllWeek) lines.push(`Najbliższy defibrylator dostępny całą dobę jest ${distance(place.nearestAllWeek.distanceM)} stąd.`);
  lines.push(
    "Przy nagłym zatrzymaniu krążenia szansa przeżycia spada z każdą minutą bez defibrylacji, a karetka rzadko dojeżdża w kilka minut. Urządzenie dostępne o każdej porze pozwala świadkom zdarzenia działać od razu.",
    `Źródło analizy: AED Hub, na podstawie danych o defibrylatorach z dane.gov.pl i OpenStreetMap oraz danych GUS o ludności. Stan danych: ${method.datasetRanAt ? new Date(method.datasetRanAt).toLocaleDateString("pl-PL") : "bieżący"}.`,
  );
  return lines.join(" ");
}
