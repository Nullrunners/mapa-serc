"use client";

import { useEffect, useRef, useState } from "react";
import { BackButton, ExternalLink, LiveMessage, Stats, type Message } from "@/components/ui";
import { hours } from "@/lib/aed-text";
import type { GapsMethod, GapsPlace } from "@/lib/api/client";
import { distance } from "@/lib/format";
import { BASIS, county, coverageNow, justification, people, placeName } from "@/lib/gaps-text";
import { googlePlace } from "@/lib/route";

export interface GapReportProps {
  place: GapsPlace;
  method: GapsMethod;
  csvHref: string;
  onClose: () => void;
}

/** Everything about one recommended place, ready to print or to paste into an application. */
export default function GapReport({ place, method, csvHref, onClose }: GapReportProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<Message | null>(null);
  const text = justification(place, method);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [place.rank]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ text: "Skopiowano do schowka.", tone: "ok" });
    } catch {
      setCopied({ text: "Nie udało się skopiować. Zaznacz tekst i skopiuj go ręcznie.", tone: "danger" });
    }
  };

  return (
    <section aria-labelledby="raport-naglowek" className="space-y-6">
      <BackButton onClick={onClose}>Wróć do listy miejsc</BackButton>

      <div className="space-y-1">
        <p className="hidden text-sm print:block">Mapa serc – raport miejsca na nowy defibrylator, {new Date().toLocaleDateString("pl-PL")}</p>
        <h2 id="raport-naglowek" ref={heading} tabIndex={-1} className="text-xl leading-snug font-bold text-balance">
          Miejsce nr {place.rank}: {placeName(place)}
        </h2>
        {place.commune && (
          <p className="text-sm text-muted">
            Gmina {place.commune.gmina}, powiat {county(place.commune.powiat)}, województwo {place.commune.wojewodztwo} (TERYT {place.commune.terc})
          </p>
        )}
        <p className="text-sm text-muted">
          Współrzędne: {place.lat.toFixed(5)}, {place.lon.toFixed(5)}.{" "}
          <ExternalLink href={googlePlace(place)} className="link print:hidden">
            Pokaż w Mapach Google
          </ExternalLink>
        </p>
      </div>

      <Stats
        className="grid-cols-2"
        items={[
          { label: `Mieszkańcy w promieniu ${method.reachM} m`, value: people(place.inReach.residents) },
          { label: "W tym w wieku 65+", value: people(place.inReach.seniors) },
          { label: "Dziś bez żadnego AED w pobliżu", value: people(place.gained.noDevice) },
          { label: "Dziś bez AED dostępnego w nocy", value: people(place.gained.noNight) },
        ]}
      />
      <p className="text-sm">
        Teraz w tym miejscu: <strong>{coverageNow(place.coveredHoursNow, method.reachM)}</strong>.{" "}
        {place.nearestAllWeek ? `Najbliższy dostępny całą dobę: ${distance(place.nearestAllWeek.distanceM)}.` : "W okolicy nie znamy żadnego defibrylatora dostępnego całą dobę."}
      </p>

      <section aria-labelledby="uzasadnienie-naglowek" className="space-y-3">
        <div>
          <h3 id="uzasadnienie-naglowek" className="font-bold">
            Gotowe uzasadnienie do wniosku
          </h3>
          <p className="hint print:hidden">Na przykład do budżetu obywatelskiego. Skopiuj i popraw według potrzeby.</p>
        </div>
        <p className="rounded-lg bg-surface p-4 text-sm leading-relaxed">{text}</p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button type="button" onClick={copy} className="btn btn-primary">
            Skopiuj tekst
          </button>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary">
            Zapisz jako PDF
          </button>
          <a href={csvHref} className="btn btn-secondary">
            Pobierz listę miejsc (CSV)
          </a>
        </div>
        <LiveMessage message={copied} className="text-sm" />
        <p className="hint print:hidden">„Zapisz jako PDF” otwiera okno drukowania. Wybierz w nim „Zapisz jako PDF” zamiast drukarki.</p>
      </section>

      <section aria-labelledby="w-poblizu-naglowek" className="space-y-2">
        <h3 id="w-poblizu-naglowek" className="font-bold">
          Defibrylatory w promieniu 600 m
        </h3>
        {place.nearby.length === 0 ? (
          <p className="hint">Nie znamy tu żadnego defibrylatora.</p>
        ) : (
          <ol className="divide-y divide-line border-y border-line text-sm">
            {place.nearby.map((device) => (
              <li key={device.id} className="space-y-0.5 px-2 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{device.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{distance(device.distanceM)}</span>
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
