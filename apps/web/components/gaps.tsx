"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, API_URL, type GapsMethod, type GapsTotals } from "@/lib/api/client";
import { useLoad } from "@/lib/use-load";
import GapReport, { coverageNow, people, placeName } from "./gap-report";
import { DETAIL_ZOOM, type MapView } from "./gaps-map";

const GapsMap = dynamic(() => import("./gaps-map"), { ssr: false, loading: () => <div className="h-full min-h-[420px] rounded border border-line bg-gov-light" aria-hidden /> });

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
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}% mieszkańców` : "");

function Totals({ totals }: { totals: GapsTotals }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {[
        ["Mieszkańcy", people(totals.residents), ""],
        ["Bez AED w promieniu 400 m", people(totals.noDevice), share(totals.noDevice, totals.residents)],
        ["Bez AED dostępnego w nocy", people(totals.noNight), share(totals.noNight, totals.residents)],
      ].map(([label, value, note]) => (
        <div key={label} className="rounded border border-line p-3">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className="text-lg font-bold leading-tight">{value}</dd>
          {note && <dd className="text-sm text-muted">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Method({ method }: { method: GapsMethod }) {
  const { devices } = method;
  return (
    <details className="rounded border border-line p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-gov">Jak to liczymy</summary>
      <div className="mt-2 space-y-2">
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
          Godziny dostępności znamy dla {devices.hours.toLocaleString("pl-PL")} z {devices.total.toLocaleString("pl-PL")} urządzeń. Dla {devices.outdoor.toLocaleString("pl-PL")} stojących na zewnątrz bez
          podanych godzin przyjmujemy całą dobę, a dla {devices.assumed.toLocaleString("pl-PL")} pozostałych dni robocze 8–16. {devices.excluded.toLocaleString("pl-PL")} urządzeń nie
          liczymy: są tylko dla personelu, wycofane, mają przeterminowane elektrody lub baterię albo przechodnie zgłosili, że ich nie ma. Dlatego liczba osób „bez żadnego AED” nie zależy od tych założeń, a liczba „bez AED w nocy” trochę tak.
        </p>
        <p>
          Wyniki są tak dobre jak dane: nie znamy każdego defibrylatora w Polsce, a część urządzeń pochodzi z OpenStreetMap i nie jest potwierdzona. Jeśli znasz defibrylator, którego brakuje,{" "}
          <Link href="/dostawca" className="text-gov underline">
            zgłoś go
          </Link>
          .
        </p>
        <p className="text-muted">Źródła: {method.sources.map((source) => `${source.name} (${source.licence})`).join("; ")}. Wynik analizy jest na licencji ODbL 1.0 i nie wchodzi do zbioru dla dane.gov.pl.</p>
      </div>
    </details>
  );
}

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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      {place && method ? (
        <GapReport place={place} method={method} csvHref={csvHref} onClose={closeReport} />
      ) : (
        <section aria-labelledby="braki-naglowek" className="space-y-5">
          <div className="space-y-3" aria-live="polite">
            <h2 id="braki-naglowek" className="text-lg font-bold">
              Cała Polska
            </h2>
            {summary.state === "loading" && <p className="text-muted">Wczytuję…</p>}
            {summary.state === "error" && (
              <p role="alert" className="text-danger">
                {summary.message}
              </p>
            )}
            {waiting && <p className="text-muted">Liczymy dane dla całego kraju. To potrwa kilkanaście sekund…</p>}
            {summary.state === "ready" && summary.data.ready && <Totals totals={summary.data.totals} />}
            {summary.state === "ready" && summary.data.ready && (
              <p className="text-sm text-muted">Według znanych danych. Na mapie im ciemniejszy kolor, tym więcej osób bez defibrylatora w pobliżu.</p>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold">Gdzie postawić nowe defibrylatory?</h2>
            <p className="text-sm">Wybierz miasto albo przybliż mapę na swoją okolicę i kliknij „Policz dla widoku mapy”.</p>
            <ul className="flex flex-wrap gap-2">
              {CITIES.map((city) => (
                <li key={city.name}>
                  <button
                    type="button"
                    onClick={() => chooseCity(city)}
                    aria-pressed={analysed?.label === city.name}
                    className={`rounded-full border-2 px-3 py-1 text-sm font-semibold ${analysed?.label === city.name ? "border-gov bg-gov text-white" : "border-gov text-gov hover:bg-gov-light"}`}
                  >
                    {city.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={analyseView} disabled={!canAnalyseView} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark disabled:cursor-not-allowed disabled:bg-muted">
              Policz dla widoku mapy
            </button>
            {!canAnalyseView && <p className="text-sm text-muted">Przybliż mapę do wielkości miasta albo dzielnicy, żeby policzyć ją dokładnie.</p>}
          </div>

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
            {result && !result.tooLarge && analysed && (
              <>
                <h2 id="miejsca-naglowek" ref={listHeading} tabIndex={-1} className="text-lg font-bold">
                  {analysed.label}: {places.length} najlepszych miejsc
                </h2>
                <Totals totals={result.totals} />
                {places.length === 0 ? (
                  <p>Na tym obszarze każdy mieszkaniec ma defibrylator dostępny całą dobę w promieniu 400 m. Nie mamy czego polecić.</p>
                ) : (
                  <>
                    <p className="text-sm text-muted">Kolejność: najpierw tam, gdzie nowy defibrylator dostępny całą dobę obejmie najwięcej osób, które dziś go w pobliżu nie mają.</p>
                    <ol className="divide-y divide-line border-y border-line">
                      {places.map((candidate) => (
                        <li key={candidate.rank} className="flex gap-3 px-1 py-3">
                          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
                            {candidate.rank}
                          </span>
                          <div className="min-w-0 space-y-0.5">
                            <h3 className="font-semibold">
                              <button type="button" onClick={() => setSelected(candidate.rank)} className="text-left text-gov underline-offset-2 hover:underline">
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
                      <a href={csvHref} className="text-gov underline">
                        Pobierz listę miejsc jako plik CSV
                      </a>{" "}
                      (otworzysz go w Excelu).
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {method && <Method method={method} />}
        </section>
      )}

      <section aria-label="Mapa" className="min-h-[420px] lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)] print:hidden">
        <GapsMap hexes={result && !result.tooLarge ? result.hexes : null} places={places} selected={selected} onSelect={setSelected} onView={onView} fitTo={fitTo} />
      </section>
    </div>
  );
}
