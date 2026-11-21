import type { Ref } from "react";
import type { GapsPlace } from "@/lib/api/client";
import { coverageNow, people, persons, placeName, plural } from "@/lib/gaps-text";

export interface PlaceListProps {
  places: GapsPlace[];
  reachM: number;
  csvHref: string;
  onSelect: (rank: number) => void;
  /** The heading takes the focus again when a place's report is closed. */
  headingRef: Ref<HTMLHeadingElement>;
}

/** The recommended places as cards, best first; the bar compares each with the best one. A click opens the report. */
export function PlaceList({ places, reachM, csvHref, onSelect, headingRef }: PlaceListProps) {
  const best = Math.max(1, ...places.map((place) => place.gained.residents));
  return (
    <section aria-labelledby="miejsca-naglowek" className="@container space-y-3">
      <div className="space-y-1">
        <h3 id="miejsca-naglowek" ref={headingRef} tabIndex={-1} className="text-lg font-bold">
          {places.length} {plural(places.length, "miejsce", "miejsca", "miejsc")} na nowe defibrylatory
        </h3>
        <p className="hint">Od najbardziej potrzebnego. Kliknij, żeby zobaczyć raport.</p>
      </div>
      <ol className="grid gap-3 @xl:grid-cols-2">
        {places.map((place) => (
          <li key={place.rank} className="relative flex gap-3 rounded-lg border border-line p-3 hover:border-gov">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
              {place.rank}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h4 className="leading-snug font-semibold">
                <button type="button" onClick={() => onSelect(place.rank)} className="text-left text-gov after:absolute after:inset-0 hover:underline">
                  <span className="sr-only">Miejsce {place.rank}: </span>
                  {placeName(place)}
                </button>
              </h4>
              <p className="text-sm">
                {persons(place.gained.residents)} zyska AED w pobliżu, w tym {people(place.gained.seniors)} w wieku 65+.
              </p>
              <div aria-hidden className="h-1.5 rounded-full bg-surface">
                <div className="h-full rounded-full bg-gov" style={{ width: `${(place.gained.residents / best) * 100}%` }} />
              </div>
              <p className="text-sm text-muted">Teraz: {coverageNow(place.coveredHoursNow, reachM)}.</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-sm">
        <a href={csvHref} className="link">
          Pobierz listę miejsc (CSV do Excela)
        </a>
      </p>
    </section>
  );
}
