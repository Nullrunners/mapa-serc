"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapPlaceholder, MapScreen } from "@/components/map-frame";
import { LoadStatus } from "@/components/ui";
import { api, API_URL } from "@/lib/api/client";
import { coverageNow, people, placeName } from "@/lib/gaps-text";
import { useLoad } from "@/lib/use-load";
import { Method } from "./method";
import { Totals } from "./national";
import GapReport from "./report";
import { CITIES, DETAIL_ZOOM, PLACES, type Bbox, type MapView } from "./shared";

const GapsMap = dynamic(() => import("./map"), { ssr: false, loading: () => <MapPlaceholder /> });

/** The map of gaps in AED cover with the figures, the best places for new devices and their reports. */
export default function Gaps({ title, lead }: { title: string; lead: string }) {
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

  const report = place && method;
  return (
    <MapScreen
      title={title}
      lead={lead}
      focused={!!report}
      view={report ? `miejsce-${place.rank}` : "lista"}
      map={<GapsMap hexes={result && !result.tooLarge ? result.hexes : null} places={places} selected={selected} onSelect={setSelected} onView={onView} fitTo={fitTo} />}
    >
      {report ? (
        <GapReport place={place} method={method} csvHref={csvHref} onClose={closeReport} />
      ) : (
        <>
          {controls}
          {results}
        </>
      )}
    </MapScreen>
  );
}
