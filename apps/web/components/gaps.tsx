"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapLayout, MapPlaceholder } from "@/components/map-frame";
import { LoadStatus } from "@/components/ui";
import { api, API_URL, type GapsMethod, type GapsTotals } from "@/lib/api/client";
import { count } from "@/lib/format";
import { coverageNow, people, placeName, share } from "@/lib/gaps-text";
import { useLoad } from "@/lib/use-load";
import GapReport from "./gap-report";
import { DETAIL_ZOOM, type MapView } from "./gaps-map";

const GapsMap = dynamic(() => import("./gaps-map"), { ssr: false, loading: () => <MapPlaceholder /> });

type Bbox = [number, number, number, number];

/** Quick starts: the biggest cities, each small enough for one analysis. */
const CITIES: { name: string; bbox: Bbox }[] = [
  { name: "Warszawa", bbox: [20.85, 52.1, 21.27, 52.37] },
  { name: "Kraków", bbox: [19.79, 49.97, 20.22, 50.13] },
  { name: "Łódź", bbox: [19.32, 51.68, 19.64, 51.85] },
  { name: "Wrocław", bbox: [16.8, 51.04, 17.18, 51.21] },
  { name: "Poznań", bbox: [16.73, 52.33, 17.07, 52.51] },
  { name: "Gdańsk", bbox: [18.43, 54.27, 18.95, 54.45] },
];

const PLACES = 10;

export default function Gaps() {
  const [view, setView] = useState<MapView | null>(null);
  const [analysed, setAnalysed] = useState<{ bbox: Bbox; label: string } | null>(null);
  const [fitTo, setFitTo] = useState<{ bbox: Bbox; seq: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const listHeading = useRef<HTMLHeadingElement>(null);

  const summary = useLoad(`summary|${tick}`, async (signal) => {
    const { data, error } = await api.GET("/v1/gaps/summary", { signal });
    if (error || !data) throw new Error("Nie udało się pobrać liczb dla Polski. Spróbuj ponownie za chwilę.");
    return data;
  });
  // The national figures take a few seconds after the server starts; ask again until they are there.
  const waiting = summary.state === "ready" && !summary.data.ready;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setTick((value) => value + 1), 4000);
    return () => clearTimeout(timer);
  }, [waiting]);

  const bboxText = analysed?.bbox.join(",") ?? "";
  const analysis = useLoad(`view|${bboxText}`, async (signal) => {
    if (!analysed) return null;
    const { data, error } = await api.GET("/v1/gaps", { params: { query: { bbox: bboxText, n: PLACES } }, signal });
    if (error || !data) throw new Error("Nie udało się policzyć luk dla tego obszaru. Spróbuj ponownie za chwilę.");
    return data;
  });

  const chooseCity = (city: (typeof CITIES)[number]) => {
    setSelected(null);
    setAnalysed({ bbox: city.bbox, label: city.name });
    setFitTo((previous) => ({ bbox: city.bbox, seq: (previous?.seq ?? 0) + 1 }));
  };
  const analyseView = () => {
    if (!view) return;
    setSelected(null);
    setAnalysed({ bbox: view.bbox, label: "Widoczny obszar mapy" });
  };
  const closeReport = () => {
    setSelected(null);
    requestAnimationFrame(() => listHeading.current?.focus());
  };
  const onView = useCallback((next: MapView) => setView(next), []);

  const result = analysis.state === "ready" ? analysis.data : null;
  const places = result && !result.tooLarge ? result.places : [];
  const place = places.find((candidate) => candidate.rank === selected) ?? null;
  const method = result?.method ?? (summary.state === "ready" ? summary.data.method : null);
  const csvHref = `${API_URL}/v1/gaps.csv?bbox=${bboxText}&n=${PLACES}`;
  const canAnalyseView = view !== null && view.zoom >= DETAIL_ZOOM;

  const map = <GapsMap hexes={result && !result.tooLarge ? result.hexes : null} places={places} selected={selected} onSelect={setSelected} onView={onView} fitTo={fitTo} />;

  if (place && method) return <MapLayout controls={<GapReport place={place} method={method} csvHref={csvHref} onClose={closeReport} />} map={map} />;

  const controls = (
    <div className="space-y-8">
      <section aria-labelledby="polska-naglowek" className="space-y-3">
        <h2 id="polska-naglowek" className="text-lg font-bold">
          Cała Polska
        </h2>
        <div aria-live="polite">
          <LoadStatus of={summary} />
          {waiting && <p className="text-muted">Liczymy dane dla całego kraju. To potrwa kilkanaście sekund…</p>}
        </div>
        {summary.state === "ready" && summary.data.ready && (
          <>
            <Totals totals={summary.data.totals} />
            <p className="hint">Według znanych danych. Na mapie: im ciemniejszy kolor, tym więcej osób bez defibrylatora w pobliżu.</p>
          </>
        )}
      </section>

      <section aria-labelledby="gdzie-naglowek" className="space-y-3">
        <h2 id="gdzie-naglowek" className="text-lg font-bold">
          Gdzie postawić nowe defibrylatory?
        </h2>
        <p>Wybierz miasto albo przybliż mapę na swoją okolicę i kliknij „Policz dla widoku mapy”.</p>
        <ul className="flex flex-wrap gap-2">
          {CITIES.map((city) => (
            <li key={city.name}>
              <button type="button" onClick={() => chooseCity(city)} aria-pressed={analysed?.label === city.name} className="chip">
                {city.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1">
          <button type="button" onClick={analyseView} disabled={!canAnalyseView} className="btn btn-primary">
            Policz dla widoku mapy
          </button>
          {!canAnalyseView && <p className="hint">Przybliż mapę do wielkości miasta albo dzielnicy, żeby policzyć ją dokładnie.</p>}
        </div>
      </section>
    </div>
  );

  const results = (
    <div className="space-y-8">
      <div aria-live="polite" className="space-y-3">
        {analysis.state === "loading" && analysed && <p className="text-muted">Liczę dla obszaru: {analysed.label}…</p>}
        {analysis.state === "error" && (
          <p role="alert" className="text-danger">
            {analysis.message}
          </p>
        )}
        {result?.tooLarge && (
          <p role="alert" className="text-danger">
            Ten obszar jest za duży, żeby policzyć go dokładnie. Przybliż mapę i spróbuj jeszcze raz.
          </p>
        )}
      </div>

      {result && !result.tooLarge && analysed && (
        <section aria-labelledby="miejsca-naglowek" className="space-y-4">
          <h2 id="miejsca-naglowek" ref={listHeading} tabIndex={-1} className="text-lg font-bold">
            {analysed.label}: {places.length} najlepszych miejsc
          </h2>
          <Totals totals={result.totals} />
          {places.length === 0 ? (
            <p>Na tym obszarze każdy mieszkaniec ma defibrylator dostępny całą dobę w promieniu 400 m. Nie mamy czego polecić.</p>
          ) : (
            <>
              <p className="hint">Najpierw tam, gdzie nowy defibrylator dostępny całą dobę obejmie najwięcej osób, które dziś go w pobliżu nie mają.</p>
              <ol className="divide-y divide-line border-y border-line">
                {places.map((candidate) => (
                  <li key={candidate.rank} className="relative flex gap-3 px-2 py-3 hover:bg-surface">
                    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
                      {candidate.rank}
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="leading-snug font-semibold">
                        <button type="button" onClick={() => setSelected(candidate.rank)} className="text-left text-gov after:absolute after:inset-0 hover:underline">
                          <span className="sr-only">Miejsce {candidate.rank}: </span>
                          {placeName(candidate)}
                        </button>
                      </h3>
                      <p className="text-sm">
                        {people(candidate.gained.residents)} mieszkańców zyska defibrylator dostępny całą dobę, w tym {people(candidate.gained.seniors)} w wieku 65+.
                      </p>
                      <p className="text-sm text-muted">Teraz: {coverageNow(candidate.coveredHoursNow)}.</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-sm">
                <a href={csvHref} className="link">
                  Pobierz listę miejsc jako plik CSV
                </a>{" "}
                <span className="text-muted">(otworzysz go w Excelu)</span>
              </p>
            </>
          )}
        </section>
      )}

      {method && <Method method={method} />}
    </div>
  );

  return <MapLayout controls={controls} map={map} results={results} />;
}

function Totals({ totals }: { totals: GapsTotals }) {
  const rows = [
    { label: "Mieszkańcy", value: people(totals.residents), note: "" },
    { label: "Bez AED w promieniu 400 m", value: people(totals.noDevice), note: share(totals.noDevice, totals.residents) },
    { label: "Bez AED dostępnego w nocy", value: people(totals.noNight), note: share(totals.noNight, totals.residents) },
  ];
  return (
    <dl className="divide-y divide-line rounded-lg bg-surface px-4">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt>
            {row.label}
            {row.note && <span className="block text-sm text-muted">{row.note}</span>}
          </dt>
          <dd className="shrink-0 text-lg font-bold tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Method({ method }: { method: GapsMethod }) {
  const { devices } = method;
  return (
    <details className="rounded-lg border border-line px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-gov">Jak to liczymy</summary>
      <div className="mt-3 space-y-2">
        <p>
          Dzielimy mapę na sześciokąty o powierzchni ok. 0,1 km². Liczbę mieszkańców bierzemy ze spisu powszechnego 2021, który podaje ją w kwadratach 1 × 1 km. Zakładamy, że w każdym kwadracie ludzie
          mieszkają równomiernie.
        </p>
        <p>
          Defibrylator liczy się dla sześciokąta, jeśli stoi najwyżej {method.reachM} m od jego środka: tyle da się przebiec tam i z powrotem w kilka minut. Liczymy też, przez ile godzin w tygodniu można do
          niego dojść. Urządzenie w urzędzie czynnym 7:30–15:30 pomaga tylko przez 40 ze 168 godzin. „W nocy” znaczy u nas: w niedzielę o {method.nightHour.replace("niedziela ", "")}.
        </p>
        <p>
          Miejsca na nowe urządzenia wybieramy po kolei. Każde następne stawiamy tam, gdzie defibrylator dostępny całą dobę obejmie najwięcej osób, które dziś go w pobliżu nie mają. Osoby w wieku 65+ liczymy{" "}
          {method.seniorWeight === 3 ? "potrójnie" : `${method.seniorWeight} razy`}, bo to u nich najczęściej dochodzi do nagłego zatrzymania krążenia.
        </p>
        <p>
          Godziny dostępności znamy dla {count(devices.hours)} z {count(devices.total)} urządzeń. Dla {count(devices.outdoor)} stojących na zewnątrz bez podanych godzin przyjmujemy całą dobę, a dla{" "}
          {count(devices.assumed)} pozostałych dni robocze 8–16. {count(devices.excluded)} urządzeń nie liczymy: są tylko dla personelu, wycofane, mają przeterminowane elektrody lub baterię albo przechodnie
          zgłosili, że ich nie ma. Dlatego liczba osób „bez żadnego AED” nie zależy od tych założeń, a liczba „bez AED w nocy” trochę tak.
        </p>
        <p>
          Wyniki są tak dobre jak dane: nie znamy każdego defibrylatora w Polsce, a część urządzeń pochodzi z OpenStreetMap i nie jest potwierdzona. Jeśli znasz defibrylator, którego brakuje,{" "}
          <Link href="/dostawca" className="link">
            zgłoś go
          </Link>
          .
        </p>
        <p className="text-muted">Źródła: {method.sources.map((source) => `${source.name} (${source.licence})`).join("; ")}. Wynik analizy jest na licencji ODbL 1.0 i nie wchodzi do zbioru dla dane.gov.pl.</p>
      </div>
    </details>
  );
}
