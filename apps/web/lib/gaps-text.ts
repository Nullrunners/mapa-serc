import type { GapsMethod, GapsNearbyDevice, GapsPlace } from "@/lib/api/client";
import { distance } from "@/lib/format";

/** Words for the analysis of gaps in AED cover: numbers of people, places and the ready justification. */

/** "37092675" → "37,1 mln", "9355" → "ok. 9400"; small numbers stay exact. */
export const people = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln`
    : value >= 1000
      ? `ok. ${(Math.round(value / 100) * 100).toLocaleString("pl-PL")}`
      : value.toLocaleString("pl-PL");

/** "73% mieszkańców"; nothing when there is no one to count. */
export const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}% mieszkańców` : "");

/** The register says "powiat Warszawa"; we write "powiat" ourselves. */
export const county = (name: string) => name.replace(/^powiat\s+/i, "");

const point = (place: GapsPlace) => `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;

export const placeName = (place: GapsPlace) => place.address ?? (place.commune ? `okolice punktu ${point(place)} (${place.commune.gmina})` : `okolice punktu ${point(place)}`);

/** Why a device near the place counts (or not) for the analysis. */
export const BASIS: Record<GapsNearbyDevice["basis"], string> = {
  hours: "Godziny podane w danych",
  outdoor: "Na zewnątrz, godzin brak: liczymy całą dobę",
  assumed: "Godzin brak: przyjęliśmy dni robocze 8–16",
  excluded: "Tylko dla personelu albo niedostępne: nie liczymy",
};

export const coverageNow = (hoursPerWeek: number) =>
  hoursPerWeek === 0 ? "brak defibrylatora w promieniu 400 m" : hoursPerWeek === 168 ? "defibrylator w pobliżu dostępny całą dobę" : `defibrylator w pobliżu dostępny przez ${hoursPerWeek} ze 168 godzin tygodnia`;

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
