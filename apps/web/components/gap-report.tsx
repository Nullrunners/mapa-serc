"use client";

import { useEffect, useRef, useState } from "react";
import { distance, hours } from "@/lib/aed-text";
import type { GapsMethod, GapsNearbyDevice, GapsPlace } from "@/lib/api/client";

/** "37092675" → "37,1 mln", "9355" → "ok. 9400"; small numbers stay exact. */
export const people = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln`
    : value >= 1000
      ? `ok. ${(Math.round(value / 100) * 100).toLocaleString("pl-PL")}`
      : value.toLocaleString("pl-PL");

/** The register says "powiat Warszawa"; we write "powiat" ourselves. */
const county = (name: string) => name.replace(/^powiat\s+/i, "");

export const placeName = (place: GapsPlace) => place.address ?? (place.commune ? `okolice punktu ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)} (${place.commune.gmina})` : `okolice punktu ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`);

const BASIS: Record<GapsNearbyDevice["basis"], string> = {
  hours: "Godziny podane w danych",
  outdoor: "Na zewnątrz, godzin brak: liczymy całą dobę",
  assumed: "Godzin brak: przyjęliśmy dni robocze 8–16",
  excluded: "Tylko dla personelu albo niedostępne: nie liczymy",
};

export const coverageNow = (hoursPerWeek: number) =>
  hoursPerWeek === 0 ? "brak defibrylatora w promieniu 400 m" : hoursPerWeek === 168 ? "defibrylator w pobliżu dostępny całą dobę" : `defibrylator w pobliżu dostępny przez ${hoursPerWeek} ze 168 godzin tygodnia`;

/** The paragraph a resident can paste into a participatory budget application. */
export function justification(place: GapsPlace, method: GapsMethod): string {
  const where = place.address ? `w okolicy adresu ${place.address}` : `w okolicy punktu ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
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

export interface GapReportProps {
  place: GapsPlace;
  method: GapsMethod;
  csvHref: string;
  onClose: () => void;
}

/** Everything about one recommended place, ready to print or to paste into an application. */
export default function GapReport({ place, method, csvHref, onClose }: GapReportProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const text = justification(place, method);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [place.rank]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <section aria-labelledby="raport-naglowek" className="space-y-5">
      <button type="button" onClick={onClose} className="text-sm font-semibold text-gov underline print:hidden">
        ← Wróć do listy miejsc
      </button>

      <div className="space-y-1">
        <p className="hidden text-sm print:block">AED Hub – raport miejsca na nowy defibrylator, {new Date().toLocaleDateString("pl-PL")}</p>
        <h2 id="raport-naglowek" ref={heading} tabIndex={-1} className="text-xl font-bold">
          Miejsce nr {place.rank}: {placeName(place)}
        </h2>
        {place.commune && (
          <p className="text-sm text-muted">
            Gmina {place.commune.gmina}, powiat {county(place.commune.powiat)}, województwo {place.commune.wojewodztwo} (TERYT {place.commune.terc})
          </p>
        )}
        <p className="text-sm text-muted">
          Współrzędne: {place.lat.toFixed(5)}, {place.lon.toFixed(5)}.{" "}
          <a href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`} className="text-gov underline print:hidden" target="_blank" rel="noopener noreferrer">
            Pokaż w Mapach Google<span className="sr-only"> (otworzy się w nowej karcie)</span>
          </a>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        {[
          [`Mieszkańcy w promieniu ${method.reachM} m`, people(place.inReach.residents)],
          ["W tym w wieku 65+", people(place.inReach.seniors)],
          ["Dziś bez żadnego AED w pobliżu", people(place.gained.noDevice)],
          ["Dziś bez AED dostępnego w nocy", people(place.gained.noNight)],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-line p-3">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        Teraz w tym miejscu: <strong>{coverageNow(place.coveredHoursNow)}</strong>.{" "}
        {place.nearestAllWeek ? `Najbliższy dostępny całą dobę: ${distance(place.nearestAllWeek.distanceM)}.` : "W okolicy nie znamy żadnego defibrylatora dostępnego całą dobę."}
      </p>

      <section aria-labelledby="uzasadnienie-naglowek" className="space-y-2">
        <h3 id="uzasadnienie-naglowek" className="font-bold">
          Gotowe uzasadnienie do wniosku
        </h3>
        <p className="text-sm text-muted print:hidden">Na przykład do budżetu obywatelskiego. Skopiuj i popraw według potrzeby.</p>
        <p className="rounded border border-line bg-gov-light p-3 text-sm leading-relaxed">{text}</p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button type="button" onClick={copy} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark">
            Skopiuj tekst
          </button>
          <button type="button" onClick={() => window.print()} className="rounded border-2 border-gov px-4 py-2 font-semibold text-gov hover:bg-gov-light">
            Zapisz jako PDF
          </button>
          <a href={csvHref} className="rounded border-2 border-gov px-4 py-2 font-semibold text-gov hover:bg-gov-light">
            Pobierz listę miejsc (CSV)
          </a>
        </div>
        <p aria-live="polite" className="text-sm">
          {copied === "done" && <span className="text-ok">Skopiowano do schowka.</span>}
          {copied === "failed" && <span className="text-danger">Nie udało się skopiować. Zaznacz tekst i skopiuj go ręcznie.</span>}
        </p>
        <p className="text-sm text-muted print:hidden">„Zapisz jako PDF” otwiera okno drukowania. Wybierz w nim „Zapisz jako PDF” zamiast drukarki.</p>
      </section>

      <section aria-labelledby="w-poblizu-naglowek" className="space-y-2">
        <h3 id="w-poblizu-naglowek" className="font-bold">
          Defibrylatory w promieniu 600 m
        </h3>
        {place.nearby.length === 0 ? (
          <p className="text-sm text-muted">Nie znamy tu żadnego defibrylatora.</p>
        ) : (
          <ol className="divide-y divide-line border-y border-line text-sm">
            {place.nearby.map((device) => (
              <li key={device.id} className="space-y-0.5 px-1 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{device.name}</span>
                  <span className="shrink-0 font-semibold text-gov">{distance(device.distanceM)}</span>
                </div>
                <p className="text-muted">
                  {device.hours ? `Godziny: ${hours(device.hours)}. ` : ""}
                  {BASIS[device.basis]}. {device.basis === "excluded" ? "" : device.atNight ? "Dostępny w nocy." : "W nocy niedostępny."}
                  {device.publication === "community" && <span className="font-semibold text-warn"> Niepotwierdzony (OpenStreetMap).</span>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="zrodla-raportu" className="space-y-1 text-sm text-muted">
        <h3 id="zrodla-raportu" className="font-bold text-ink">
          Skąd te liczby
        </h3>
        <p>
          Mieszkańcy: spis powszechny 2021 w kwadratach 1 × 1 km. Przyjmujemy, że w każdym kwadracie mieszkają równomiernie, więc liczby dla małego obszaru są szacunkiem. Defibrylatory: dane urzędowe i
          OpenStreetMap. Nie znamy każdego urządzenia w Polsce, dlatego piszemy „według znanych danych”.
        </p>
        <ul className="list-disc pl-5">
          {method.sources.map((source) => (
            <li key={source.name}>
              {source.name} ({source.licence}). {source.attribution}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
