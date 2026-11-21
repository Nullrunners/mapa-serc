"use client";

import type { Ref } from "react";
import { BackButton, Stats } from "@/components/ui";
import type { GapsTotals, GapsView } from "@/lib/api/client";
import type { Area } from "@/lib/gaps-area";
import { conclusions, km2, people, share } from "@/lib/gaps-text";
import type { Loaded } from "@/lib/use-load";
import { CoverageBar } from "./coverage-bar";
import { Method } from "./method";
import { PlaceList } from "./place-list";

export interface DashboardProps {
  area: Area;
  analysis: Loaded<GapsView | null>;
  /** The country, to compare with. */
  poland: GapsTotals | null;
  csvHref: string;
  onClear: () => void;
  onRetry: () => void;
  onSelect: (rank: number) => void;
  headingRef: Ref<HTMLHeadingElement>;
  listRef: Ref<HTMLHeadingElement>;
}

/**
 * Everything about the analysed area, in the wide panel: the conclusions first, then the figures behind them and the
 * places for new devices. On a wide screen the figures and the places stand side by side.
 */
export function Dashboard({ area, analysis, poland, csvHref, onClear, onRetry, onSelect, headingRef, listRef }: DashboardProps) {
  const result = analysis.state === "ready" ? analysis.data : null;
  const counted = result && !result.tooLarge ? result : null;
  const about = [area.detail, counted ? `ok. ${km2(counted.km2)}` : null].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="obszar-naglowek" className="space-y-6">
      <div className="space-y-1">
        <BackButton onClick={onClear}>Wybierz inny obszar</BackButton>
        <h2 id="obszar-naglowek" ref={headingRef} tabIndex={-1} className="text-xl leading-snug font-bold text-balance">
          {area.label}
        </h2>
        {about && <p className="text-sm text-muted">{about}</p>}
      </div>

      <div aria-live="polite" className="space-y-3">
        {analysis.state === "loading" && <p className="text-muted">Liczę…</p>}
        {analysis.state === "error" && (
          <div role="alert" className="space-y-2">
            <p className="text-danger">{analysis.message}</p>
            <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">
              Spróbuj jeszcze raz
            </button>
          </div>
        )}
        {result?.tooLarge && (
          <p role="alert" className="text-danger">
            Za duży obszar. Zaznacz mniejszy, np. miasto albo dzielnicę.
          </p>
        )}
      </div>

      {counted && (
        <>
          <section aria-labelledby="wnioski-naglowek" className="space-y-2 rounded-lg border-l-4 border-gov bg-gov-light px-4 py-3">
            <h3 id="wnioski-naglowek" className="text-lg font-bold">
              Wnioski
            </h3>
            <ul className="list-disc space-y-1.5 pl-5">
              {conclusions(counted, poland).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          <div className="grid gap-8 @4xl:grid-cols-2">
            <div className="@container space-y-6">
              <Stats
                className="grid-cols-2 @2xl:grid-cols-4"
                items={[
                  { label: "Mieszkańcy", value: people(counted.totals.residents) },
                  { label: "W tym w wieku 65+", value: people(counted.totals.seniors), note: share(counted.totals.seniors, counted.totals.residents) },
                  { label: `Bez AED w promieniu ${counted.method.reachM} m`, value: people(counted.totals.noDevice), note: share(counted.totals.noDevice, counted.totals.residents) },
                  { label: "Bez AED dostępnego w nocy", value: people(counted.totals.noNight), note: share(counted.totals.noNight, counted.totals.residents) },
                ]}
              />
              <CoverageBar totals={counted.totals} reachM={counted.method.reachM} />
            </div>

            {counted.places.length > 0 ? (
              <PlaceList places={counted.places} reachM={counted.method.reachM} csvHref={csvHref} onSelect={onSelect} headingRef={listRef} />
            ) : (
              <p>
                {counted.totals.residents > 0
                  ? `Każdy ma tu AED dostępny całą dobę w promieniu ${counted.method.reachM} m.`
                  : "Według spisu nikt tu nie mieszka."}
              </p>
            )}
          </div>

          <Method method={counted.method} />
        </>
      )}
    </section>
  );
}
