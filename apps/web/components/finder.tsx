"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import DeviceList, { pickedFrom, type Picked } from "@/components/device-list";
import { MapLayout, MapPlaceholder } from "@/components/map-frame";
import { ExternalLink } from "@/components/ui";
import { addressLine, title, type When } from "@/lib/aed-text";
import { api } from "@/lib/api/client";
import { count, distance, minutes } from "@/lib/format";
import { nextSundayNight } from "@/lib/reach-text";
import { MAX_WALK_M, googleDirections, straightDistance, walkingRoute, type Point, type WalkingRoute } from "@/lib/route";
import { useLoad, type Loaded } from "@/lib/use-load";
import AedDetails from "./aed-details";
import type { WalkOnMap } from "./aed-map";

// MapLibre needs a browser; it is loaded only on the client, after the list is already usable.
const AedMap = dynamic(() => import("./aed-map"), { ssr: false, loading: () => <MapPlaceholder /> });

const LIMIT = 20;

export default function Finder() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [near, setNear] = useState<Point | null>(null);
  const [locating, setLocating] = useState<"idle" | "asking" | "denied">("idle");
  const [showCommunity, setShowCommunity] = useState(true);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  // With a known position the list is ordered by how soon a device is in hand, not by straight-line distance.
  const [order, setOrder] = useState<"reach" | "distance">("reach");
  const [when, setWhen] = useState<When>("now");
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
          limit: LIMIT,
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

  const map = <AedMap showCommunity={showCommunity} focus={near} walk={walk} selected={selected} onSelect={setSelected} />;

  if (selected) {
    return (
      <MapLayout
        controls={<AedDetails picked={selected} from={near} layer={layer} onlyAvailable={onlyAvailable} onPick={setSelected} onClose={closeDetails} walkNote={walkNote} />}
        map={map}
      />
    );
  }

  const controls = (
    <div className="space-y-4">
      <form
        role="search"
        className="space-y-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label htmlFor="szukaj" className="label">
          Miejscowość, ulica lub nazwa miejsca
        </label>
        <div className="flex gap-2">
          <input id="szukaj" type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="field min-w-0 flex-1" autoComplete="off" />
          <button type="submit" className="btn btn-primary">
            Szukaj
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={locate} disabled={locating === "asking"} className="btn btn-secondary">
          <LocateIcon />
          {locating === "asking" ? "Ustalam położenie…" : "Pokaż najbliższe mnie"}
        </button>
        {near && (
          <button type="button" onClick={() => setNear(null)} className="text-sm font-semibold text-gov hover:underline">
            Wyczyść położenie
          </button>
        )}
      </div>
      {locating === "denied" && (
        <p role="alert" className="text-sm text-danger">
          Nie udało się ustalić, gdzie jesteś. Wpisz miejscowość albo ulicę w polu wyszukiwania.
        </p>
      )}

      {near && walkNote && nearest && (
        <section aria-labelledby="droga-naglowek" className="space-y-2 rounded-lg border border-l-4 border-line border-l-danger p-4">
          <h2 id="droga-naglowek" className="text-sm font-semibold text-danger">
            Droga do najbliższego defibrylatora
          </h2>
          <div>
            <button type="button" onClick={() => setSelected(pickedFrom(nearest))} className="text-left text-lg leading-snug font-bold text-gov hover:underline">
              {title(nearest)}
            </button>
            {addressLine(nearest) && <p className="text-sm">{addressLine(nearest)}</p>}
          </div>
          {walkNote}
          <ExternalLink href={googleDirections(near, pickedFrom(nearest))} className="btn btn-primary">
            Prowadź mnie w Mapach Google
          </ExternalLink>
          <p className="text-xs text-muted">Drogę wyznacza bezpłatny serwis map OpenStreetMap (FOSSGIS). Wysyłamy mu tylko Twoje położenie i miejsce urządzenia.</p>
        </section>
      )}
    </div>
  );

  const results = (
    <section aria-labelledby="lista-naglowek" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="lista-naglowek" ref={listHeading} tabIndex={-1} className="text-lg font-bold">
          {near ? "Najbliższe urządzenia" : "Urządzenia"}
        </h2>
        <p aria-live="polite" className="text-sm text-muted">
          {list.state === "loading" && "Wczytuję…"}
          {list.state === "ready" && list.data.total > 0 && `Znaleziono: ${count(list.data.total)}${list.data.total > list.data.items.length ? `, poniżej ${list.data.items.length} pierwszych` : ""}`}
        </p>
      </div>

      <div className="space-y-3 rounded-lg bg-surface p-3 text-sm">
        {near && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Kolejność</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["reach", "Najszybciej w ręku"],
                  ["distance", "Najbliżej w linii prostej"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="chip">
                  <input type="radio" name="kolejnosc" value={value} checked={order === value} onChange={() => setOrder(value)} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
            {order === "reach" && (
              <p className="text-muted">Liczymy dojście, godziny otwarcia, święta, szafkę z kodem albo recepcję i piętro. Defibrylator na ścianie 250 m dalej wygrywa z zamkniętym urzędem obok.</p>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor="kiedy" className="font-semibold">
            Dostępność
          </label>
          <select id="kiedy" value={when} onChange={(event) => setWhen(event.target.value as When)} className="field py-1">
            <option value="now">teraz</option>
            <option value="night">w nocy z soboty na niedzielę, o 3:00</option>
          </select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} className="size-4" />
            {when === "now" ? "Tylko dostępne teraz" : "Tylko dostępne o tej porze"}
          </label>
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={showCommunity} onChange={(event) => setShowCommunity(event.target.checked)} className="mt-0.5 size-4" />
          <span>
            Pokaż też niepotwierdzone urządzenia
            <span className="block text-muted">Pochodzą z OpenStreetMap, więc mogą być nieaktualne. Nie trafiają do oficjalnych danych na dane.gov.pl.</span>
          </span>
        </label>
      </div>

      {list.state === "error" && (
        <p role="alert" className="text-danger">
          {list.message}
        </p>
      )}
      {list.state === "ready" &&
        (list.data.total === 0 ? <p>Nic nie znaleźliśmy. Spróbuj innej nazwy albo miejscowości.</p> : <DeviceList items={list.data.items} when={when} onPick={setSelected} />)}
    </section>
  );

  return <MapLayout controls={controls} map={map} results={results} />;
}

/** How far the walk is and how long it takes; the way itself is drawn on the map. */
function WalkNote({ route, from, to, tooFar }: { route: Loaded<WalkingRoute | null>; from: Point; to: Point; tooFar: boolean }) {
  let text: string;
  if (tooFar) text = `To ${distance(Math.round(straightDistance(from, to)))} w linii prostej, za daleko, żeby pokazać drogę pieszo.`;
  else if (route.state === "loading") text = "Wyznaczam drogę pieszo…";
  else if (route.state === "ready" && route.data) text = `Pieszo ${distance(route.data.distanceM)}, ${minutes(route.data.durationS)}. Drogę zaznaczyliśmy na mapie na czerwono.`;
  else text = "Nie udało się wyznaczyć drogi. Na mapie przerywana linia pokazuje kierunek w linii prostej.";
  return (
    <p aria-live="polite" className="text-sm">
      {text}
    </p>
  );
}

function LocateIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}
