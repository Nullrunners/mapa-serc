"use client";

import { useState, type FormEvent } from "react";
import { api, problemMessage, type GapsLocality } from "@/lib/api/client";
import { county } from "@/lib/gaps-text";
import type { Loaded } from "@/lib/use-load";

/**
 * A commune by the name of a town or village in it, for those who do not click on the map. The state register of
 * addresses knows places, not communes, and many share a name, so the person picks the right one from a list.
 */
export function CommuneSearch({ onPick, busy }: { onPick: (locality: GapsLocality) => void; busy: boolean }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Loaded<GapsLocality[]> | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setFound({ state: "loading" });
    const { data, error } = await api.GET("/v1/gaps/localities", { params: { query: { q } } }).catch(() => ({ data: undefined, error: undefined }));
    setFound(data ? { state: "ready", data: data.items } : { state: "error", message: problemMessage(error, "Wyszukiwarka chwilowo nie działa. Kliknij gminę na mapie.") });
  };

  return (
    <form role="search" onSubmit={search} className="space-y-2">
      <label htmlFor="gmina-szukaj" className="label">
        Gmina po nazwie miejscowości
      </label>
      <div className="flex gap-2">
        <input id="gmina-szukaj" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="np. Legionowo" autoComplete="off" className="field min-w-0 flex-1" />
        <button type="submit" className="btn btn-secondary">
          Szukaj
        </button>
      </div>
      <div aria-live="polite" className="text-sm">
        {found?.state === "loading" && <p className="text-muted">Szukam…</p>}
        {found?.state === "error" && <p className="text-danger">{found.message}</p>}
        {found?.state === "ready" && found.data.length === 0 && <p>Nie znaleźliśmy takiej miejscowości. Sprawdź pisownię albo kliknij gminę na mapie.</p>}
        {found?.state === "ready" && found.data.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {found.data.map((locality) => (
              <li key={`${locality.name}|${locality.lat}|${locality.lon}`}>
                <button type="button" disabled={busy} onClick={() => onPick(locality)} className="w-full px-3 py-2 text-left hover:bg-surface disabled:opacity-60">
                  <span className="font-semibold text-gov">{locality.name}</span>
                  <span className="block text-muted">
                    gmina {locality.gmina}, powiat {county(locality.powiat)}, {locality.wojewodztwo}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="hint">Policzymy całą gminę, w której leży wybrana miejscowość.</p>
    </form>
  );
}
