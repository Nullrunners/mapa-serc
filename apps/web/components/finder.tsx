"use client";

import dynamic from "next/dynamic";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import DeviceList, { pickedFrom, type Picked } from "@/components/device-list";
import { GuideBanner, GuideIcon, GuidePanel } from "@/components/guide";
import { MapPlaceholder, MapScreen } from "@/components/map-frame";
import { ExternalLink } from "@/components/ui";
import { addressLine, title as deviceTitle, type When } from "@/lib/aed-text";
import { api } from "@/lib/api/client";
import { count, distance, minutes } from "@/lib/format";
import { nextSundayNight } from "@/lib/reach-text";
import { MAX_WALK_M, OFF_WAY_M, follow, googleDirections, straightDistance, walkingRoute, type Point, type WalkingRoute } from "@/lib/route";
import { guideWords } from "@/lib/route-text";
import { useLoad, type Loaded } from "@/lib/use-load";
import AedDetails from "./aed-details";
import type { GuideOnMap, WalkOnMap } from "./aed-map";

// MapLibre needs a browser; it is loaded only on the client, after the list is already usable.
const AedMap = dynamic(() => import("./aed-map"), { ssr: false, loading: () => <MapPlaceholder /> });

const LIMIT = 20;

/** A new way is asked for at most this often: the person keeps moving while the router answers. */
const REROUTE_MS = 10_000;
/** Less than this is the GPS wandering, not the person moving. */
const MOVED_M = 10;

/** A position goes to our API and to the router; 5 decimals is about a metre, more than either needs. */
const rounded = (lat: number, lon: number): Point => ({ lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });

/** The map of all devices with the search, the way to the nearest one and the list; `title` and `lead` head the panel. */
export default function Finder({ title, lead }: { title: string; lead: string }) {
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
  // Leading the person to the device open in the panel: where they are as they walk, and whether we still hear it.
  const [guiding, setGuiding] = useState(false);
  const [here, setHere] = useState<Point | null>(null);
  const [lost, setLost] = useState(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const wayRef = useRef<WalkingRoute | null>(null);
  const reroutedAt = useRef(0);

  const startGuiding = (picked: Picked) => {
    reroutedAt.current = 0;
    setSelected(picked);
    setGuiding(true);
  };

  const stopGuiding = () => {
    setGuiding(false);
    setHere(null);
    setLost(false);
    // The person has walked on: the list and the next way start from where they are now.
    if (here && near && straightDistance(near, here) > MOVED_M) setNear(rounded(here.lat, here.lon));
  };

  /** Opens a device in the panel. The person was led to the one open until now, so with another one that ends. */
  const pick = (picked: Picked) => {
    if (guiding && picked.id !== selected?.id) stopGuiding();
    setSelected(picked);
  };

  const closeDetails = () => {
    if (guiding) stopGuiding();
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

  // We can lead the person as soon as the device is within a walk; the way itself may still be on its way.
  const way = route.state === "ready" ? route.data : null;
  const canGuide = walkable !== null && (route.state === "loading" || way !== null);
  // Until the first reading comes in, the person is where they last told us they were.
  const position = guiding ? (here ?? near) : null;
  const progress = useMemo(() => (way && position ? follow(way, position) : null), [way, position]);
  const guideOnMap = useMemo<GuideOnMap | null>(
    () => (position ? { at: progress?.at ?? position, bearing: progress?.bearing ?? null, rest: progress?.rest ?? null } : null),
    [position, progress],
  );
  const words = position ? guideWords(progress, route.state === "loading") : null;

  useEffect(() => {
    wayRef.current = way;
  }, [way]);

  useEffect(() => {
    if (!guiding) return;
    const watch = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const fix = { lat: coords.latitude, lon: coords.longitude };
        setHere(fix);
        setLost(false);
        // Off the way by more than the GPS can be wrong: ask for a new way from here.
        const current = wayRef.current;
        if (current && timestamp - reroutedAt.current > REROUTE_MS && follow(current, fix).offM > Math.max(OFF_WAY_M, coords.accuracy)) {
          reroutedAt.current = timestamp;
          setNear(rounded(fix.lat, fix.lon));
        }
      },
      () => setLost(true),
      { enableHighAccuracy: true, maximumAge: 1000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [guiding]);

  /** `quiet` when we look on our own: a failure then shows no error, the button is still there to try again. */
  const locate = (quiet = false) => {
    if (!("geolocation" in navigator)) return setLocating(quiet ? "idle" : "denied");
    setLocating("asking");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNear(rounded(position.coords.latitude, position.coords.longitude));
        setLocating("idle");
      },
      () => setLocating(quiet ? "idle" : "denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // With location already allowed for this site, the nearest device and the way to it come up as soon as the map
  // opens. We never ask on our own: the browser's question comes only after the button.
  const locateOnEntry = useEffectEvent(() => locate(true));
  useEffect(() => {
    let left = false;
    navigator.permissions?.query({ name: "geolocation" }).then(
      (status) => {
        if (!left && status.state === "granted") locateOnEntry();
      },
      () => {},
    );
    return () => {
      left = true;
    };
  }, []);

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
        <button type="button" onClick={() => locate()} disabled={locating === "asking"} className="btn btn-secondary">
          <LocateIcon />
          {locating === "asking" ? "Ustalam położenie…" : "Najbliżej mnie"}
        </button>
        {near && (
          <button type="button" onClick={() => setNear(null)} className="text-sm font-semibold text-gov hover:underline">
            Wyczyść położenie
          </button>
        )}
      </div>
      {locating === "denied" && (
        <p role="alert" className="text-sm text-danger">
          Nie znamy Twojego położenia. Wpisz miejscowość.
        </p>
      )}

      {near && walkNote && nearest && (
        <section aria-labelledby="droga-naglowek" className="space-y-2 rounded-lg border border-l-4 border-line border-l-danger p-4">
          <h2 id="droga-naglowek" className="text-sm font-semibold text-danger">
            Najbliższy defibrylator
          </h2>
          <div>
            <button type="button" onClick={() => pick(pickedFrom(nearest))} className="text-left text-lg leading-snug font-bold text-gov hover:underline">
              {deviceTitle(nearest)}
            </button>
            {addressLine(nearest) && <p className="text-sm">{addressLine(nearest)}</p>}
          </div>
          {walkNote}
          <div className="flex flex-wrap gap-2">
            {canGuide && (
              <button type="button" onClick={() => startGuiding(pickedFrom(nearest))} className="btn btn-primary">
                <GuideIcon />
                Prowadź mnie
              </button>
            )}
            <ExternalLink href={googleDirections(near, pickedFrom(nearest))} className={canGuide ? "btn btn-secondary" : "btn btn-primary"}>
              Trasa w Mapach Google
            </ExternalLink>
          </div>
          <p className="text-xs text-muted">Trasę liczy OpenStreetMap (FOSSGIS) z Twojego położenia.</p>
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
          {list.state === "ready" && list.data.total > 0 && `Znaleziono: ${count(list.data.total)}${list.data.total > list.data.items.length ? ` (widać ${list.data.items.length})` : ""}`}
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
                  ["distance", "W linii prostej"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="chip">
                  <input type="radio" name="kolejnosc" value={value} checked={order === value} onChange={() => setOrder(value)} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
            {order === "reach" && <p className="text-muted">Liczymy dojście, godziny otwarcia i sposób dostępu.</p>}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor="kiedy" className="font-semibold">
            Dostępność
          </label>
          <select id="kiedy" value={when} onChange={(event) => setWhen(event.target.value as When)} className="field py-1">
            <option value="now">teraz</option>
            <option value="night">w nocy (niedziela, 3:00)</option>
          </select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} className="size-4" />
            {when === "now" ? "Tylko dostępne teraz" : "Tylko dostępne o tej porze"}
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showCommunity} onChange={(event) => setShowCommunity(event.target.checked)} className="size-4" />
          Pokaż też niepotwierdzone (z OpenStreetMap)
        </label>
      </div>

      {list.state === "error" && (
        <p role="alert" className="text-danger">
          {list.message}
        </p>
      )}
      {list.state === "ready" &&
        (list.data.total === 0 ? <p>Nic nie znaleźliśmy. Spróbuj innej nazwy.</p> : <DeviceList items={list.data.items} when={when} onPick={pick} />)}
    </section>
  );

  return (
    <MapScreen
      title={title}
      lead={lead}
      focused={selected !== null}
      view={selected ? `urzadzenie-${selected.id}` : "lista"}
      tallMap={guiding}
      map={<AedMap showCommunity={showCommunity} focus={near} walk={walk} guide={guideOnMap} banner={words && <GuideBanner words={words} />} selected={selected} onSelect={pick} />}
    >
      {selected ? (
        <AedDetails
          picked={selected}
          from={near}
          layer={layer}
          onlyAvailable={onlyAvailable}
          onPick={pick}
          onClose={closeDetails}
          walkNote={guiding ? null : walkNote}
          onGuide={!guiding && canGuide ? () => startGuiding(selected) : undefined}
          guidance={words && <GuidePanel words={words} steps={way?.steps ?? []} next={progress && !progress.arrived ? progress.next : null} lost={lost} onStop={stopGuiding} />}
        />
      ) : (
        <>
          {controls}
          {results}
        </>
      )}
    </MapScreen>
  );
}

/** How far the walk is and how long it takes; the way itself is drawn on the map. */
function WalkNote({ route, from, to, tooFar }: { route: Loaded<WalkingRoute | null>; from: Point; to: Point; tooFar: boolean }) {
  let text: string;
  if (tooFar) text = `${distance(Math.round(straightDistance(from, to)))} w linii prostej, za daleko na pieszo.`;
  else if (route.state === "loading") text = "Wyznaczam trasę…";
  else if (route.state === "ready" && route.data) text = `Pieszo ${distance(route.data.distanceM)}, ${minutes(route.data.durationS)}.`;
  else text = "Brak trasy. Linia na mapie pokazuje kierunek.";
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
