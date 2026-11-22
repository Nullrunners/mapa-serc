"use client";

import { LngLat, Marker, type ExpressionSpecification, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AED_KINDS, aedImage, aedImageId } from "@/components/aed-icon";
import { GuideBanner } from "@/components/guide";
import { MapFrame, MapUnavailable } from "@/components/map-frame";
import { distance, minutes } from "@/lib/format";
import { lineFeature, pointFeature, useMapLibre, type SourceData } from "@/lib/maplibre";
import { lessMotion } from "@/lib/motion";
import { pointAhead, walkAt, type Point, type WalkingRoute } from "@/lib/route";
import { guideWords, type GuideWords } from "@/lib/route-text";

/**
 * The walk to a device played out in 3D before the person sets off: the camera comes down from above the whole way to
 * just behind a walker, who then goes the whole way on their own between the buildings, with the same turn-by-turn
 * words as the real guidance. It is the same map in a separate full-screen view; nothing here knows where the person
 * really is.
 */

// The camera rides behind the walker and looks at the ground ahead of them. MapLibre draws the ground only up to about
// seven times the distance from the camera to the middle of the map, so that middle has to be ahead of the walker, not
// on them: like this some 190 m of the city is in view. A wider view (20, 10, 10) leans back less, at about 72°.
const BEHIND_M = 16;
const ABOVE_M = 6;
const AHEAD_M = 12;
// A device usually hangs inside a building, so the last metres of the way go through a wall. Over them the camera
// rises above the roofs and draws back, looking down at the walker, and from there goes round the device.
const FINALE_M = 30;
const FINALE_UP_M = 40;
const FINALE_BACK_M = 40;
const RISE_S = 0.8;
/** The walker's height as a share of the view, with the camera where it usually is. */
const WALKER_SHARE = 16;

/** The walker's speed in km/h, as the person sets it: from a slow walk to fast-forward; faster outruns the map tiles. */
const SLOWEST_KMH = 3;
const FASTEST_KMH = 60;
/** At first the whole way takes about this long, though never slower than a sprint. */
const RUN_S = 45;
const FIRST_MIN_KMH = 15;
/** What a speed means to a person on foot, up to each limit; above the last one the walk is fast-forwarded. */
const GAITS: [number, string][] = [
  [7, "marsz"],
  [16, "bieg"],
  [26, "sprint"],
];
const gaitOf = (kmh: number) => GAITS.find(([below]) => kmh < below)?.[1] ?? "przewijanie";

/** How quickly the camera swings round after the walker: the time it takes to cover most of a turn. */
const TURN_S = 0.45;
/** The way down from above the whole way to behind the walker. */
const DROP_MS = 3500;
/** Waiting for the map before the way down, at most this long. */
const WAIT_MS = 3000;
/** At the end the camera goes once round the device. */
const ORBIT_DEG_S = 10;

/** Dragging the view: degrees of turn and metres of height for each pixel, and how long it stays before it eases back. */
const LOOK_DEG_PX = 0.3;
const LOOK_M_PX = 0.03;
const LOOK_HOLD_MS = 1200;
const LOOK_BACK_S = 0.5;
const LIFT_MIN_M = -3;
const LIFT_MAX_M = 12;

/** The turn buttons stop this far before a turn, where the banner says what to do there. */
const BEFORE_TURN_M = 8;

const WALK_COLOR = "#b00020";
const AED = AED_KINDS[0];
const EARTH_CIRCUMFERENCE_M = 40_075_016.7;

type Phase = "loading" | "intro" | "walking" | "arrived";

export interface Route3DProps {
  /** The way to walk; it ends at the device. */
  route: WalkingRoute;
  onClose: () => void;
  /** Starts the real guidance to the same device. */
  onGuide?: () => void;
}

/** Everything the frame loop reads and changes; React only hears about what the screen shows. */
interface Sim {
  phase: Phase;
  playing: boolean;
  /** Metres a second. */
  speed: number;
  doneM: number;
  heading: number;
  orbitLeft: number;
  /** How far up the camera is for the end of the way, from 0 to 1. */
  rise: number;
  yaw: number;
  lift: number;
  drag: { x: number; y: number; yaw: number; lift: number } | null;
  lookUntil: number;
  resized: number;
  words: string;
  shownM: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toLngLat = (point: Point) => new LngLat(point.lon, point.lat);

/** A width in metres on the ground at latitude `lat`, never thinner than `floorPx` on the screen. */
function metres(widthM: number, lat: number, floorPx: number): ExpressionSpecification {
  // At zoom z one metre is 512 · 2^z / (circumference · cos lat) pixels: below `from` the floor wins.
  const from = clamp(Math.log2((floorPx * EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * widthM)), 0, 23);
  return ["interpolate", ["exponential", 2], ["zoom"], from, floorPx, 24, floorPx * 2 ** (24 - from)];
}

/** A round column standing on the device, seen from far down the way. */
function column(center: Point, radiusM: number): SourceData {
  const sides = 16;
  // Counter-clockwise, as GeoJSON wants the outside of a polygon.
  const ring = Array.from({ length: sides + 1 }, (_, index) => {
    const point = pointAhead(center, (-index * 360) / sides, radiusM);
    return [point.lon, point.lat];
  });
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** Where the camera is relative to the walker: metres behind and above them, and how far ahead it looks. */
function rig(lift: number, rise: number) {
  return { behind: BEHIND_M + rise * FINALE_BACK_M, above: ABOVE_M + rise * FINALE_UP_M + lift, ahead: AHEAD_M * (1 - rise) };
}

/** The camera behind the walker at `at`, facing `heading`, `lift` metres higher than usual, `rise` of the way up for the end. */
function camera(map: MapLibreMap, at: Point, heading: number, lift: number, rise: number) {
  const { behind, above, ahead } = rig(lift, rise);
  const eye = pointAhead(at, heading, -behind);
  const look = pointAhead(at, heading, ahead);
  return map.calculateCameraOptionsFromTo(toLngLat(eye), above, toLngLat(look), 0);
}

/** How far up the camera is for the end: from nothing to all the way over the last `FINALE_M` metres. */
const riseFor = (leftM: number) => clamp((FINALE_M - leftM) / FINALE_M, 0, 1);

/** The walker's height on the screen: smaller as the camera draws away from them. */
function walkerHeight(lift: number, rise: number): string {
  const { behind, above } = rig(lift, rise);
  return `${((WALKER_SHARE * Math.hypot(BEHIND_M, ABOVE_M)) / Math.hypot(behind, above)).toFixed(2)}%`;
}

/** Turns `from` part of the way towards `to` over `dt` seconds, the short way round. */
function turnTowards(from: number, to: number, dt: number): number {
  const left = ((to - from + 540) % 360) - 180;
  return (from + left * (1 - Math.exp(-dt / TURN_S)) + 360) % 360;
}

const wordsKey = (words: GuideWords) => `${words.title}|${words.note}|${words.then}|${words.left}`;

// The walker, seen from behind: a figure in the colours of the site with a heart on its back. Static markup, no data.
const WALKER = `<svg viewBox="0 0 40 80" width="100%" height="100%" overflow="visible">
<ellipse cx="20" cy="77" rx="13" ry="3.5" fill="#000" opacity=".25"/>
<g data-part="body">
<rect data-part="leg" x="11.5" y="44" width="7.5" height="31" rx="3.75" fill="#003d7a" stroke="#fff" stroke-width="2"/>
<rect data-part="leg" x="21" y="44" width="7.5" height="31" rx="3.75" fill="#003d7a" stroke="#fff" stroke-width="2"/>
<rect x="8" y="20" width="24" height="30" rx="10" fill="#0052a5" stroke="#fff" stroke-width="2.5"/>
<circle cx="20" cy="11" r="8" fill="#0052a5" stroke="#fff" stroke-width="2.5"/>
<path d="M20 41c-4.5-3-7-5.6-7-8.6a3.5 3.5 0 0 1 7-1.2 3.5 3.5 0 0 1 7 1.2c0 3-2.5 5.6-7 8.6z" fill="#fff"/>
</g>
</svg>`;

/** The walker as a map marker, sized to the view so it stays a person among the buildings, and its steps. */
function makeWalker(still: boolean): { element: HTMLElement; steps: Animation[] } {
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  // A share of the map's height, set from the camera's distance; small while the whole way is seen from above.
  element.style.height = "6%";
  element.style.aspectRatio = "1 / 2";
  element.style.pointerEvents = "none";
  element.innerHTML = WALKER;
  if (still) return { element, steps: [] };
  const step = { duration: 420, iterations: Infinity, direction: "alternate", easing: "ease-in-out" } as const;
  const [left, right] = element.querySelectorAll<SVGElement>('[data-part="leg"]');
  const body = element.querySelector<SVGElement>('[data-part="body"]');
  const steps = [
    left?.animate([{ transform: "translateY(0)" }, { transform: "translateY(-4px)" }], step),
    right?.animate([{ transform: "translateY(-4px)" }, { transform: "translateY(0)" }], step),
    body?.animate([{ transform: "translateY(0)" }, { transform: "translateY(-1.5px)" }], { ...step, duration: 210 }),
  ].filter((animation): animation is Animation => !!animation);
  for (const animation of steps) animation.pause();
  return { element, steps };
}

/** Roughly how wide each kind of road of the base map is on the ground, in metres; the first name that fits wins. */
const ROAD_WIDTHS: [string, number][] = [
  ["motorway_link", 4.5],
  ["service_track", 3.5],
  ["path_pedestrian", 2],
  ["secondary_tertiary", 7],
  ["trunk_primary", 9],
  ["motorway", 10],
  ["link", 4.5],
  ["minor", 5],
  ["street", 5],
];

/**
 * The base map's roads stop growing at zoom 20, where a street is a metre wide; up close they get their width on the
 * ground instead. Further out they keep the style's own widths.
 */
function widenRoads(map: MapLibreMap, lat: number) {
  const pixelsPerMetre = (zoom: number) => (512 * 2 ** zoom) / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180));
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "line" || layer["source-layer"] !== "transportation" || layer.id.includes("rail")) continue;
    const road = ROAD_WIDTHS.find(([name]) => layer.id.includes(name));
    const width: unknown = map.getPaintProperty(layer.id, "line-width");
    if (!road || !Array.isArray(width) || width[0] !== "interpolate" || !Array.isArray(width[2]) || width[2][0] !== "zoom") continue;
    const stops = width.slice(3);
    if (stops.some((stop) => typeof stop !== "number")) continue;
    const widthM = road[1] + (layer.id.includes("casing") ? 1 : 0);
    const far = stops.flatMap((stop, index) => (index % 2 === 0 && stop <= 16 ? [stop, stops[index + 1]] : []));
    const near = [17, 18, 19, 20, 21, 22, 23, 24].flatMap((zoom) => [zoom, widthM * pixelsPerMetre(zoom)]);
    map.setPaintProperty(layer.id, "line-width", ["interpolate", width[1], ["zoom"], ...far, ...near]);
  }
}

/** The base map as a small city: solid buildings that hide what is behind them, a sky, street names and nothing else. */
function buildWorld(map: MapLibreMap, route: WalkingRoute) {
  const end = route.line[route.line.length - 1];
  const target = { lat: end[1], lon: end[0] };
  const lat = route.line[0][1];
  widenRoads(map, lat);

  map.setSky({ "sky-color": "#8ec5f5", "horizon-color": "#f8f4f0", "sky-horizon-blend": 0.6 });
  map.setLight({ anchor: "map", position: [1.5, 135, 50], intensity: 0.4 });

  // Up close only the street names help; place names and road numbers would float in the air.
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && !layer.id.startsWith("highway-name")) map.setLayoutProperty(layer.id, "visibility", "none");
  }

  // The way, as wide as a pavement, under the buildings: one in front of it hides it as it would in the street.
  const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
  map.addSource("walk", { type: "geojson", data: lineFeature(route.line) });
  map.addLayer({ id: "walk-casing", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": "#ffffff", "line-width": metres(2.2, lat, 7) } });
  map.addLayer({ id: "walk-line", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": WALK_COLOR, "line-width": metres(1.4, lat, 4) } });
  map.addSource("aim", { type: "geojson", data: pointFeature(target) });
  map.addLayer({
    id: "aim-ring",
    type: "circle",
    source: "aim",
    paint: {
      "circle-radius": metres(5, lat, 8),
      "circle-color": AED.color,
      "circle-opacity": 0.25,
      "circle-stroke-color": AED.color,
      "circle-stroke-width": 3,
      "circle-pitch-alignment": "map",
      "circle-pitch-scale": "map",
    },
  });

  if (map.getLayer("building-3d")) {
    map.moveLayer("building-3d");
    // Opaque, so each building is drawn once and hides the way behind it; taller ones a deeper blue-grey.
    map.setPaintProperty("building-3d", "fill-extrusion-opacity", 1);
    map.setPaintProperty("building-3d", "fill-extrusion-color", ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, "#e6e9ee", 15, "#d5dde6", 40, "#bccadb", 120, "#9fb2c8"]);
  }

  // A green column of light over the device, seen from down the way and between the roofs, with its sign at the foot.
  map.addSource("beacon", { type: "geojson", data: column(target, 1.5) });
  map.addLayer({ id: "beacon", type: "fill-extrusion", source: "beacon", paint: { "fill-extrusion-color": AED.color, "fill-extrusion-height": 40, "fill-extrusion-opacity": 0.5 } });
  const sign = aedImage(AED);
  if (sign) {
    map.addImage(aedImageId(AED), sign, { pixelRatio: 2 });
    map.addLayer({
      id: "aim-sign",
      type: "symbol",
      source: "aim",
      layout: { "icon-image": aedImageId(AED), "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true },
    });
  }
}

export default function Route3D({ route, onClose, onGuide }: Route3DProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const endHeading = useRef<HTMLHeadingElement>(null);
  const walker = useRef<Marker | null>(null);
  const steps = useRef<Animation[]>([]);

  const totalM = route.alongM[route.alongM.length - 1];
  // About RUN_S for the whole way to start with; the person changes it as they like.
  const firstKmh = clamp(Math.round((totalM / RUN_S) * 3.6), FIRST_MIN_KMH, FASTEST_KMH);
  const bounds = useMemo(() => {
    const lons = route.line.map(([lon]) => lon);
    const lats = route.line.map(([, lat]) => lat);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] as [number, number, number, number];
  }, [route]);
  /** Where the turn buttons stop: the start, and a few steps before each turn and before the device. */
  const stops = useMemo(() => [0, ...route.steps.filter((step) => step.turn !== "start").map((step) => Math.max(0, step.atM - BEFORE_TURN_M))], [route]);

  const [still] = useState(lessMotion);
  const [phase, setPhase] = useState<Phase>("loading");
  const [playing, setPlaying] = useState(!still);
  const [kmh, setKmh] = useState(firstKmh);
  const [words, setWords] = useState(() => guideWords(walkAt(route, 0), false));
  const [shownM, setShownM] = useState(0);
  const sim = useRef<Sim>({
    phase: "loading",
    playing: !still,
    speed: firstKmh / 3.6,
    doneM: 0,
    heading: route.steps[0]?.heading ?? 0,
    orbitLeft: 0,
    rise: 0,
    yaw: 0,
    lift: 0,
    drag: null,
    lookUntil: 0,
    resized: 0,
    words: "",
    shownM: 0,
  });

  // The map on the screen; a map made and dropped at once (React's development double start) is not it.
  const live = useRef<MapLibreMap | null>(null);

  const go = (next: Phase) => {
    sim.current.phase = next;
    setPhase(next);
  };

  /** The walker grows with the way down; after it their size follows the camera frame by frame. */
  const growWalker = (ms: number) => {
    const element = walker.current?.getElement();
    if (!element) return;
    element.style.transition = ms ? `height ${ms}ms ease-in` : "";
    if (ms) element.style.height = walkerHeight(0, sim.current.rise);
  };

  /** From the whole way seen from above down to behind the walker at the start. */
  const comeDown = (map: MapLibreMap) => {
    const s = sim.current;
    if (s.phase !== "loading" || live.current !== map) return;
    go("intro");
    const start = walkAt(route, 0);
    s.heading = start.bearing;
    s.rise = riseFor(start.leftM);
    map.once("moveend", () => {
      growWalker(0);
      if (sim.current.phase === "intro") go("walking");
    });
    growWalker(DROP_MS);
    map.easeTo({ ...camera(map, start.at, s.heading, 0, s.rise), duration: DROP_MS, essential: true });
  };

  const { frame, container, map: mapRef, drawable } = useMapLibre(
    (map) => {
      live.current = map;
      buildWorld(map, route);
      const made = makeWalker(still);
      steps.current = made.steps;
      const start = route.line[0];
      walker.current = new Marker({ element: made.element, anchor: "bottom", pitchAlignment: "viewport", rotationAlignment: "viewport", subpixelPositioning: true })
        .setLngLat(start)
        .addTo(map);
      map.on("resize", () => sim.current.resized++);
      if (sim.current.phase !== "loading") return;
      if (still) {
        // Straight to the start, nothing moves on its own.
        sim.current.heading = walkAt(route, 0).bearing;
        go("walking");
        return;
      }
      // Down from above once the map is there, or after a while anyway: a slow network should not hold it up.
      map.once("idle", () => comeDown(map));
      setTimeout(() => comeDown(map), WAIT_MS);
    },
    {
      bare: true,
      label: "Widok trasy w 3D",
      options: { bounds, fitBoundsOptions: { padding: 48, maxZoom: 17 }, maxPitch: 85, interactive: false, pixelRatio: Math.min(window.devicePixelRatio, 2) },
    },
  );

  useEffect(
    () => () => {
      live.current = null;
    },
    [],
  );

  // Open as a modal before the map is made, so the map finds its box already the size of the screen.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    heading.current?.focus();
  }, []);

  // One loop for the walk and the camera; React state only for what the controls and the banner show.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let applied = "";
    let shownAt = 0;
    const frameStep = (time: number) => {
      raf = requestAnimationFrame(frameStep);
      const map = mapRef.current;
      const s = sim.current;
      const dt = clamp((time - last) / 1000, 0, 0.1);
      last = time;
      if (!map || s.phase === "loading" || s.phase === "intro") return;

      if (s.phase === "walking" && s.playing) {
        s.doneM = Math.min(totalM, s.doneM + s.speed * dt);
        if (s.doneM >= totalM) {
          s.playing = false;
          setPlaying(false);
          s.orbitLeft = still ? 0 : 360;
          s.phase = "arrived";
          setPhase("arrived");
        }
      }
      const progress = walkAt(route, s.doneM);
      if (s.phase === "arrived" && s.orbitLeft > 0) {
        const turn = Math.min(s.orbitLeft, ORBIT_DEG_S * dt);
        s.heading = (s.heading + turn) % 360;
        s.orbitLeft -= turn;
      } else s.heading = turnTowards(s.heading, progress.bearing, dt);
      if (!s.drag && time > s.lookUntil) {
        const back = Math.exp(-dt / LOOK_BACK_S);
        s.yaw = Math.abs(s.yaw) < 0.05 ? 0 : s.yaw * back;
        s.lift = Math.abs(s.lift) < 0.01 ? 0 : s.lift * back;
      }

      const riseTo = s.phase === "arrived" ? 1 : riseFor(progress.leftM);
      s.rise = Math.abs(riseTo - s.rise) < 0.001 ? riseTo : s.rise + (riseTo - s.rise) * (1 - Math.exp(-dt / RISE_S));

      const pose = `${progress.at.lat.toFixed(7)},${progress.at.lon.toFixed(7)},${(s.heading + s.yaw).toFixed(2)},${s.lift.toFixed(2)},${s.rise.toFixed(3)},${s.resized}`;
      if (pose !== applied) {
        applied = pose;
        const marker = walker.current;
        if (marker) {
          const height = walkerHeight(s.lift, s.rise);
          if (marker.getElement().style.height !== height) marker.getElement().style.height = height;
          marker.setLngLat([progress.at.lon, progress.at.lat]);
        }
        map.jumpTo(camera(map, progress.at, s.heading + s.yaw, s.lift, s.rise));
      }

      const next = guideWords(progress, false);
      if (wordsKey(next) !== s.words) {
        s.words = wordsKey(next);
        setWords(next);
      }
      const metresDone = Math.round(s.doneM);
      if (metresDone !== s.shownM && time - shownAt > 100) {
        s.shownM = metresDone;
        shownAt = time;
        setShownM(metresDone);
      }
    };
    raf = requestAnimationFrame(frameStep);
    return () => cancelAnimationFrame(raf);
  }, [mapRef, route, totalM, still]);

  // The walker's legs move only while they walk, quicker the faster they go.
  useEffect(() => {
    const moving = playing && phase === "walking";
    for (const animation of steps.current) {
      animation.updatePlaybackRate(clamp(kmh / 12, 0.5, 2.5));
      if (moving) animation.play();
      else animation.pause();
    }
  }, [playing, phase, kmh]);

  useEffect(() => {
    if (phase === "arrived") endHeading.current?.focus();
  }, [phase]);

  /** Any control cuts the way down short: the camera goes straight behind the walker. */
  const skipIntro = () => {
    const s = sim.current;
    if (s.phase !== "loading" && s.phase !== "intro") return;
    s.heading = walkAt(route, s.doneM).bearing;
    go("walking");
    growWalker(0);
    mapRef.current?.stop();
  };

  const seek = (metresTo: number) => {
    skipIntro();
    const s = sim.current;
    s.doneM = clamp(metresTo, 0, totalM);
    s.orbitLeft = 0;
    s.heading = walkAt(route, s.doneM).bearing;
    if (s.phase === "arrived" && s.doneM < totalM) go("walking");
    s.shownM = Math.round(s.doneM);
    setShownM(s.shownM);
  };

  const play = (on: boolean) => {
    sim.current.playing = on;
    setPlaying(on);
  };

  const again = () => {
    seek(0);
    play(true);
  };

  const togglePlay = () => {
    skipIntro();
    if (sim.current.phase === "arrived") again();
    else play(!sim.current.playing);
  };

  const nextTurn = () => seek(stops.find((stop) => stop > sim.current.doneM + 1) ?? totalM);
  const previousTurn = () => {
    const doneM = sim.current.doneM;
    seek([...stops].reverse().find((stop) => stop < doneM - 1) ?? 0);
  };

  const setSpeed = (value: number) => {
    sim.current.speed = value / 3.6;
    setKmh(value);
  };

  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      aria-labelledby="trasa-3d-naglowek"
      onClose={onClose}
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none flex-col overscroll-contain bg-white p-0 text-ink open:flex"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 id="trasa-3d-naglowek" ref={heading} tabIndex={-1} className="text-lg leading-tight font-bold">
          Trasa do defibrylatora w 3D
        </h2>
        <button type="button" onClick={close} className="btn btn-secondary btn-sm">
          Zamknij
        </button>
      </div>

      <div
        className="relative min-h-0 flex-1 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          skipIntro();
          event.currentTarget.setPointerCapture(event.pointerId);
          const s = sim.current;
          s.drag = { x: event.clientX, y: event.clientY, yaw: s.yaw, lift: s.lift };
        }}
        onPointerMove={(event) => {
          const s = sim.current;
          if (!s.drag) return;
          // The world goes with the finger: drag left to look right, down to rise above the street.
          s.yaw = s.drag.yaw - (event.clientX - s.drag.x) * LOOK_DEG_PX;
          s.lift = clamp(s.drag.lift + (event.clientY - s.drag.y) * LOOK_M_PX, LIFT_MIN_M, LIFT_MAX_M);
        }}
        onPointerUp={() => letGo(sim.current)}
        onPointerCancel={() => letGo(sim.current)}
      >
        {drawable ? (
          <MapFrame frameRef={frame} containerRef={container}>
            {phase !== "loading" && <GuideBanner words={words} />}
            {phase === "loading" && <p className="absolute top-2 left-2 rounded-md bg-white/95 px-2.5 py-1.5 text-sm shadow-sm">Wczytuję mapę…</p>}
            {phase !== "loading" && (
              // The same speed as on the slider below, which a screen reader announces; on a phone the map's
              // credits take the bottom edge, so it stands above them.
              <div aria-hidden className="absolute bottom-14 left-2 rounded-lg bg-white/95 px-3 py-1.5 leading-tight shadow-sm sm:bottom-2">
                <p>
                  <span className="text-2xl font-bold tabular-nums">{kmh}</span> <span className="text-sm font-semibold">km/h</span>
                </p>
                <p className="text-xs text-muted">{gaitOf(kmh)}</p>
              </div>
            )}
          </MapFrame>
        ) : (
          <MapUnavailable>Ta przeglądarka nie wyświetli widoku 3D.</MapUnavailable>
        )}
      </div>

      {drawable && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          <p className="sr-only">{[words.title, words.note, words.then, words.left].filter(Boolean).join(". ")}</p>
          <p role="status" className="sr-only">
            {words.say}
          </p>

          {phase === "arrived" ? (
            <section aria-labelledby="koniec-trasy" className="space-y-2 rounded-lg border border-l-4 border-line border-l-ok p-3">
              <h3 id="koniec-trasy" ref={endHeading} tabIndex={-1} className="font-bold">
                Koniec trasy
              </h3>
              <p className="text-sm">
                Pieszo {distance(route.distanceM)}, {minutes(route.durationS)}.
              </p>
              <div className="flex flex-wrap gap-2">
                {onGuide && (
                  <button type="button" onClick={onGuide} className="btn btn-primary">
                    Prowadź mnie
                  </button>
                )}
                <button type="button" onClick={again} className={onGuide ? "btn btn-secondary" : "btn btn-primary"}>
                  Jeszcze raz
                </button>
              </div>
            </section>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={togglePlay} className="btn btn-primary btn-sm min-w-28">
                {playing ? "Wstrzymaj" : "Odtwórz"}
              </button>
              <button type="button" onClick={previousTurn} className="btn btn-secondary btn-sm">
                Poprzedni zakręt
              </button>
              <button type="button" onClick={nextTurn} className="btn btn-secondary btn-sm">
                Następny zakręt
              </button>
              <button type="button" onClick={() => seek(0)} className="btn btn-secondary btn-sm">
                Od początku
              </button>
              <div className="flex items-center gap-2">
                <label htmlFor="predkosc-3d" className="text-sm font-semibold">
                  Prędkość
                </label>
                <input
                  id="predkosc-3d"
                  type="range"
                  min={SLOWEST_KMH}
                  max={FASTEST_KMH}
                  step={1}
                  value={kmh}
                  aria-valuetext={`${kmh} km/h, ${gaitOf(kmh)}`}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                  className="w-36 accent-gov"
                />
              </div>
            </div>
          )}

          <input
            type="range"
            aria-label="Miejsce na trasie"
            aria-valuetext={`${distance(shownM)} z ${distance(Math.round(totalM))}`}
            min={0}
            max={Math.round(totalM)}
            step={1}
            value={shownM}
            onChange={(event) => seek(Number(event.target.value))}
            className="w-full accent-gov"
          />
          <p className="text-xs text-muted">To podgląd trasy, nie Twoje położenie. Przeciągnij widok, żeby się rozejrzeć.</p>
        </div>
      )}
    </dialog>
  );
}

/** The view was dragged and let go: it stays a moment, then eases back behind the walker. */
function letGo(s: Sim) {
  if (!s.drag) return;
  s.drag = null;
  s.yaw = (((s.yaw % 360) + 540) % 360) - 180;
  s.lookUntil = performance.now() + LOOK_HOLD_MS;
}
