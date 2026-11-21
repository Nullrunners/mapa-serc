"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { ACCESS_LABEL, AVAILABLE_NOW, addressLine, distance, hours, title } from "@/lib/aed-text";
import { api, type AedItem } from "@/lib/api/client";
import { AVAILABLE_AT_NIGHT, nextSundayNight, reachSummary } from "@/lib/reach-text";
import { MAX_WALK_M, googleDirections, straightDistance, walkTime, walkingRoute, type Point, type WalkingRoute } from "@/lib/route";
import { useLoad, type Loaded } from "@/lib/use-load";
import AedDetails, { pickedFrom, type Picked } from "./aed-details";
import type { WalkOnMap } from "./aed-map";

// MapLibre needs a browser; it is loaded only on the client, after the list is already usable.
const AedMap = dynamic(() => import("./aed-map"), { ssr: false, loading: () => <div className="h-full min-h-[420px] rounded border border-line bg-gov-light" aria-hidden /> });

export default function Finder() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [near, setNear] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState<"idle" | "asking" | "denied">("idle");
  const [showCommunity, setShowCommunity] = useState(true);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  // With a known position the list is ordered by how soon a device is in hand, not by straight-line distance.
  const [order, setOrder] = useState<"reach" | "distance">("reach");
  const [when, setWhen] = useState<"now" | "night">("now");
  const [selected, setSelected] = useState<Picked | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  const closeDetails = () => {
    setSelected(null);
    // The list comes back in place of the panel; put the keyboard focus where the person left it.
    requestAnimationFrame(() => listHeading.current?.focus());
  };

  const layer = showCommunity ? "all" : "official";
  const list = useLoad(`${layer}|${submitted}|${near?.lat},${near?.lon}|${onlyAvailable}|${order}|${when}`, async (signal) => {
    const { data, error } = await api.GET("/v1/aed", {
      params: {
        query: {
          layer,
          q: submitted || undefined,
          near: near ? `${near.lat},${near.lon}` : undefined,
          availableNow: onlyAvailable ? "true" : undefined,
          sort: near ? order : undefined,
          at: when === "night" ? nextSundayNight() : undefined,
          limit: 20,
        },
      },
      signal,
    });
    if (error || !data) throw new Error("Nie udało się pobrać listy urządzeń. Spróbuj ponownie za chwilę.");
    return data;
  });

  // With a known position the way is shown to the device in the panel, or else to the first one on the list.
  const nearest = near && list.state === "ready" ? list.data.items[0] : undefined;
  const target: Picked | null = near ? (selected ?? (nearest ? pickedFrom(nearest) : null)) : null;
  const walkable = near && target && straightDistance(near, target) <= MAX_WALK_M ? target : null;
  const route = useLoad(near && walkable ? `${near.lat},${near.lon}|${walkable.lat},${walkable.lon}` : "", (signal) =>
    near && walkable ? walkingRoute(near, walkable, signal) : Promise.resolve(null),
  );
  // Same way, same object: the map refits only when the way itself changes.
  const toLat = walkable?.lat;
  const toLon = walkable?.lon;
  const routeResult = route.state === "ready" ? route.data : route.state;
  const walk = useMemo<WalkOnMap | null>(() => {
    if (!near || toLat === undefined || toLon === undefined) return null;
    const line = routeResult === "loading" ? "loading" : routeResult === "error" || routeResult === null ? "straight" : routeResult.line;
    return { from: near, to: { lat: toLat, lon: toLon }, line };
  }, [near, toLat, toLon, routeResult]);
  const walkNote = near && target ? <WalkNote route={route} from={near} to={target} tooFar={!walkable} /> : null;

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
      {selected ? (
        <AedDetails picked={selected} from={near} layer={layer} onlyAvailable={onlyAvailable} onPick={setSelected} onClose={closeDetails} walkNote={walkNote} />
      ) : (
      <section aria-labelledby="lista-naglowek" className="space-y-4">
        <h2 id="lista-naglowek" ref={listHeading} tabIndex={-1} className="text-lg font-bold">
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

        {walkNote && nearest && (
          <section aria-labelledby="droga-naglowek" className="space-y-2 rounded border-2 border-danger p-3">
            <h3 id="droga-naglowek" className="font-bold">
              Droga do najbliższego defibrylatora
            </h3>
            <p>
              <button type="button" onClick={() => setSelected(pickedFrom(nearest))} className="text-left font-semibold text-gov underline-offset-2 hover:underline">
                {title(nearest)}
              </button>
              {addressLine(nearest) && <span className="block text-sm">{addressLine(nearest)}</span>}
            </p>
            {walkNote}
            <a
              href={googleDirections(near, pickedFrom(nearest))}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark"
            >
              Prowadź mnie w Mapach Google<span className="sr-only"> (otworzy się w nowej karcie)</span>
            </a>
            <p className="text-xs text-muted">Drogę wyznacza bezpłatny serwis map OpenStreetMap (FOSSGIS). Wysyłamy mu tylko Twoje położenie i miejsce urządzenia.</p>
          </section>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={showCommunity} onChange={(event) => setShowCommunity(event.target.checked)} className="mt-1 size-4" />
          <span>
            Pokaż też urządzenia, które nie zostały jeszcze potwierdzone
            <span className="block text-muted">Pochodzą z OpenStreetMap, więc mogą być nieaktualne. Nie trafiają do oficjalnych danych na dane.gov.pl.</span>
          </span>
        </label>

        {near && (
          <fieldset className="space-y-1 text-sm">
            <legend className="font-semibold">Kolejność</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="kolejnosc" checked={order === "reach"} onChange={() => setOrder("reach")} className="mt-1 size-4" />
              <span>
                Najszybciej w ręku
                <span className="block text-muted">Liczymy dojście, godziny otwarcia, święta, szafkę z kodem albo recepcję i piętro. Defibrylator na ścianie 250 m dalej wygrywa z zamkniętym urzędem obok.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="kolejnosc" checked={order === "distance"} onChange={() => setOrder("distance")} className="mt-1 size-4" />
              <span>Najbliżej w linii prostej</span>
            </label>
          </fieldset>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="kiedy" className="font-semibold">
            Sprawdź dostępność
          </label>
          <select id="kiedy" value={when} onChange={(event) => setWhen(event.target.value as "now" | "night")} className="rounded border border-muted px-2 py-1">
            <option value="now">teraz</option>
            <option value="night">w nocy z soboty na niedzielę, o 3:00</option>
          </select>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} className="mt-1 size-4" />
          <span>
            {when === "now" ? "Pokaż tylko dostępne teraz" : "Pokaż tylko dostępne o tej porze"}
            <span className="block text-muted">Tylko urządzenia, o których wiemy, że wtedy można się do nich dostać.</span>
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
                  <li key={item.id} className="space-y-1 px-1 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">
                        <button type="button" onClick={() => setSelected(pickedFrom(item))} className="text-left text-gov underline-offset-2 hover:underline">
                          {title(item)}
                        </button>
                      </h3>
                      {item.distanceM !== null && <span className="shrink-0 text-sm font-semibold text-gov">{distance(item.distanceM)}</span>}
                    </div>
                    {addressLine(item) && <p className="text-sm">{addressLine(item)}</p>}
                    {item.record.opis_lokalizacji && <p className="text-sm text-muted">{item.record.opis_lokalizacji}</p>}
                    {item.reach ? (
                      <ReachLine item={item} />
                    ) : (
                      <p className={`text-sm font-semibold ${(when === "now" ? AVAILABLE_NOW : AVAILABLE_AT_NIGHT)[item.availableNow].tone}`}>
                        {(when === "now" ? AVAILABLE_NOW : AVAILABLE_AT_NIGHT)[item.availableNow].label}
                      </p>
                    )}
                    <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                      {item.record.godziny_dostepnosci && <span>Godziny: {hours(item.record.godziny_dostepnosci)}</span>}
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
      )}

      <section aria-label="Mapa" className="min-h-[420px] lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)]">
        <AedMap showCommunity={showCommunity} focus={near} walk={walk} selected={selected} onSelect={setSelected} />
      </section>
    </div>
  );
}

/** How far the walk is and how long it takes; the way itself is drawn on the map. */
function WalkNote({ route, from, to, tooFar }: { route: Loaded<WalkingRoute | null>; from: Point; to: Point; tooFar: boolean }) {
  let text: string;
  if (tooFar) text = `To ${distance(Math.round(straightDistance(from, to)))} w linii prostej, za daleko, żeby pokazać drogę pieszo.`;
  else if (route.state === "loading") text = "Wyznaczam drogę pieszo…";
  else if (route.state === "ready" && route.data) text = `Pieszo ${distance(route.data.distanceM)}, ${walkTime(route.data.durationS)}. Drogę zaznaczyliśmy na mapie na czerwono.`;
  else text = "Nie udało się wyznaczyć drogi. Na mapie przerywana linia pokazuje kierunek w linii prostej.";
  return (
    <p aria-live="polite" className="text-sm">
      {text}
    </p>
  );
}

/** Whether the device can be reached at the chosen moment, how soon, and why. */
function ReachLine({ item }: { item: AedItem }) {
  const summary = reachSummary(item.reach!, item.record.pietro);
  return (
    <div className="space-y-0.5 text-sm">
      <p className={`font-semibold ${summary.tone}`}>
        {summary.headline}
        {summary.eta && <span className="font-normal text-ink"> · {summary.eta}</span>}
      </p>
      {summary.details.length > 0 && <p className="text-muted">{summary.details.join(" · ")}</p>}
    </div>
  );
}
