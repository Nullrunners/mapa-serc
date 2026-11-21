"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { api, type AedItem } from "@/lib/api/client";
import { useLoad } from "@/lib/use-load";

// MapLibre needs a browser; it is loaded only on the client, after the list is already usable.
const AedMap = dynamic(() => import("./aed-map"), { ssr: false, loading: () => <div className="h-full min-h-[420px] rounded border border-line bg-gov-light" aria-hidden /> });

const ACCESS_LABEL: Record<string, string> = { publiczny: "dostęp publiczny", ograniczony: "dostęp ograniczony", prywatny: "tylko dla personelu" };

/** The answer to "can I get to it right now?", in words, so that it does not depend on colour. */
const AVAILABLE_NOW = {
  yes: { label: "Dostępny teraz", tone: "text-ok" },
  no: { label: "Teraz niedostępny", tone: "text-danger" },
  unknown: { label: "Nie wiadomo, czy teraz dostępny: dane nie podają godzin", tone: "text-muted" },
} as const;

const distance = (metres: number) => (metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1).replace(".", ",")} km`);

const address = (item: AedItem) => {
  const { record } = item;
  const street = [record.cecha_ulicy === "ulica" ? "ul." : record.cecha_ulicy, record.nazwa_ulicy, record.nr_budynku].filter(Boolean).join(" ");
  return [street, [record.kod_pocztowy, record.miejscowosc].filter(Boolean).join(" ")].filter(Boolean).join(", ");
};

export default function Finder() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [near, setNear] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState<"idle" | "asking" | "denied">("idle");
  const [showCommunity, setShowCommunity] = useState(true);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const layer = showCommunity ? "all" : "official";
  const list = useLoad(`${layer}|${submitted}|${near?.lat},${near?.lon}|${onlyAvailable}`, async (signal) => {
    const { data, error } = await api.GET("/v1/aed", {
      params: { query: { layer, q: submitted || undefined, near: near ? `${near.lat},${near.lon}` : undefined, availableNow: onlyAvailable ? "true" : undefined, limit: 20 } },
      signal,
    });
    if (error || !data) throw new Error("Nie udało się pobrać listy urządzeń. Spróbuj ponownie za chwilę.");
    return data;
  });

  const locate = () => {
    if (!("geolocation" in navigator)) return setLocating("denied");
    setLocating("asking");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNear({ lat: Number(position.coords.latitude.toFixed(5)), lon: Number(position.coords.longitude.toFixed(5)) });
        setLocating("idle");
      },
      () => setLocating("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-labelledby="lista-naglowek" className="space-y-4">
        <h2 id="lista-naglowek" className="text-lg font-bold">
          {near ? "Najbliższe urządzenia" : "Urządzenia"}
        </h2>

        <form
          role="search"
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query.trim());
          }}
        >
          <label htmlFor="szukaj" className="block text-sm font-semibold">
            Nazwa miejsca, ulica lub miejscowość
          </label>
          <div className="flex gap-2">
            <input id="szukaj" type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 rounded border border-muted px-3 py-2" autoComplete="off" />
            <button type="submit" className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark">
              Szukaj
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={locate} className="rounded border-2 border-gov px-3 py-1.5 text-sm font-semibold text-gov hover:bg-gov-light">
            {locating === "asking" ? "Ustalam położenie…" : "Pokaż najbliższe mnie"}
          </button>
          {near && (
            <button type="button" onClick={() => setNear(null)} className="text-sm text-gov underline">
              Wyczyść położenie
            </button>
          )}
        </div>
        {locating === "denied" && (
          <p role="alert" className="text-sm text-danger">
            Nie udało się ustalić, gdzie jesteś. Wpisz miejscowość albo ulicę w polu wyszukiwania.
          </p>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={showCommunity} onChange={(event) => setShowCommunity(event.target.checked)} className="mt-1 size-4" />
          <span>
            Pokaż też urządzenia, które nie zostały jeszcze potwierdzone
            <span className="block text-muted">Pochodzą z OpenStreetMap, więc mogą być nieaktualne. Nie trafiają do oficjalnych danych na dane.gov.pl.</span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} className="mt-1 size-4" />
          <span>
            Pokaż tylko dostępne teraz
            <span className="block text-muted">Tylko urządzenia, o których wiemy, że w tej chwili można się do nich dostać.</span>
          </span>
        </label>

        <div aria-live="polite">
          {list.state === "loading" && <p className="text-muted">Wczytuję…</p>}
          {list.state === "error" && (
            <p role="alert" className="text-danger">
              {list.message}
            </p>
          )}
          {list.state === "ready" && (
            <>
              <p className="text-sm text-muted">
                {list.data.total === 0 ? "Nic nie znaleźliśmy. Spróbuj innej nazwy albo miejscowości." : `Znaleziono: ${list.data.total}. Poniżej ${list.data.items.length} pierwszych.`}
              </p>
              <ol className="mt-2 divide-y divide-line border-y border-line">
                {list.data.items.map((item) => (
                  <li key={item.id} className={`space-y-1 px-1 py-3 ${selected === item.id ? "bg-gov-light" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{item.record.nazwa}</h3>
                      {item.distanceM !== null && <span className="shrink-0 text-sm font-semibold text-gov">{distance(item.distanceM)}</span>}
                    </div>
                    {address(item) && <p className="text-sm">{address(item)}</p>}
                    {item.record.opis_lokalizacji && <p className="text-sm text-muted">{item.record.opis_lokalizacji}</p>}
                    <p className={`text-sm font-semibold ${AVAILABLE_NOW[item.availableNow].tone}`}>{AVAILABLE_NOW[item.availableNow].label}</p>
                    <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                      {item.record.godziny_dostepnosci && <span>Godziny: {item.record.godziny_dostepnosci === "24/7" ? "całą dobę" : item.record.godziny_dostepnosci}</span>}
                      {item.record.dostep && <span>{ACCESS_LABEL[item.record.dostep] ?? item.record.dostep}</span>}
                      {item.publication === "community" && <span className="font-semibold text-warn">jeszcze niepotwierdzone (OpenStreetMap)</span>}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </section>

      <section aria-label="Mapa" className="min-h-[420px] lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)]">
        <AedMap showCommunity={showCommunity} focus={near} onSelect={setSelected} />
      </section>
    </div>
  );
}
