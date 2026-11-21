"use client";

import { LiveMessage, LoadStatus, type Message } from "@/components/ui";
import type { GapsLocality, GapsSummary } from "@/lib/api/client";
import type { Loaded } from "@/lib/use-load";
import { CommuneSearch } from "./commune-search";
import { Totals } from "./national";
import { CITIES, type Bbox } from "./shared";

export interface AreaPickerProps {
  summary: Loaded<GapsSummary>;
  onCity: (city: { name: string; bbox: Bbox }) => void;
  canAnalyseView: boolean;
  onAnalyseView: () => void;
  onLocality: (locality: GapsLocality) => void;
  /** How the search for a commune's boundary went. */
  lookup: Message | null;
  busy: boolean;
}

/** The panel before an area is chosen: the figures for the whole country and the ways to choose one. */
export function AreaPicker({ summary, onCity, canAnalyseView, onAnalyseView, onLocality, lookup, busy }: AreaPickerProps) {
  const waiting = summary.state === "ready" && !summary.data.ready;
  return (
    <div className="space-y-8">
      <section aria-labelledby="polska-naglowek" className="space-y-3">
        <h2 id="polska-naglowek" className="text-lg font-bold">
          Cała Polska
        </h2>
        <div aria-live="polite">
          <LoadStatus of={summary} />
          {waiting && <p className="text-muted">Liczymy dane dla całej Polski…</p>}
        </div>
        {summary.state === "ready" && summary.data.ready && <Totals totals={summary.data.totals} reachM={summary.data.method.reachM} />}
      </section>

      <section aria-labelledby="obszar-wybor" className="space-y-4">
        <div className="space-y-2">
          <h2 id="obszar-wybor" className="text-lg font-bold">
            Sprawdź swoją okolicę
          </h2>
          <p>Zaznacz obszar na mapie: prostokątem, lassem albo klikając gminę.</p>
        </div>
        <LiveMessage message={lookup} className="text-sm" />

        <div className="space-y-2">
          <h3 className="font-semibold">Albo wybierz miasto</h3>
          <ul className="flex flex-wrap gap-2">
            {CITIES.map((city) => (
              <li key={city.name}>
                <button type="button" onClick={() => onCity(city)} className="chip">
                  {city.name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <CommuneSearch onPick={onLocality} busy={busy} />

        <div className="space-y-1">
          <button type="button" onClick={onAnalyseView} disabled={!canAnalyseView} className="btn btn-secondary">
            Policz dla widoku mapy
          </button>
          {!canAnalyseView && <p className="hint">Najpierw przybliż mapę.</p>}
        </div>
      </section>
    </div>
  );
}
