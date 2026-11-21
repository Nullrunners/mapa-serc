/**
 * Shared MapLibre setup. Import this module before creating a map, from every component that draws one,
 * so the map works whichever page a person opens first.
 */
import { FullscreenControl, Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

// maplibre-gl 6 looks for its worker next to its own module (import.meta.url). Once Turbopack bundles it
// into a chunk that file is not there, so the workers fail to load. Point it at the worker explicitly;
// `new URL(..., import.meta.url)` makes Turbopack emit the file as a static asset.
setWorkerUrl(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
/** Poland as the map first shows it. */
export const POLAND: [number, number, number, number] = [14.1, 49.0, 24.2, 54.9];
/** How far the map can be moved: Poland and about 80 km around it, no further. */
const POLAND_LIMIT: [number, number, number, number] = [12.9, 48.3, 25.4, 55.5];

export type SourceData = Parameters<GeoJSONSource["setData"]>[0];
export const EMPTY: SourceData = { type: "FeatureCollection", features: [] };

/** Polish names of the map's own buttons; they are read out by screen readers. */
const LOCALE = {
  "Map.Title": "Mapa",
  "NavigationControl.ZoomIn": "Przybliż",
  "NavigationControl.ZoomOut": "Oddal",
  "FullscreenControl.Enter": "Pokaż mapę na pełnym ekranie",
  "FullscreenControl.Exit": "Zamknij pełny ekran",
  "AttributionControl.ToggleAttribution": "Pokaż lub ukryj źródła mapy",
};

/** MapLibre needs WebGL2. Without it the constructor throws, and an uncaught error would take the page down too. */
export function canDrawMap(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

/**
 * A map of Poland that cannot be moved away from it, with our style, Polish names and Polish labels on its buttons,
 * or null when the browser refuses WebGL (blocked driver, too many open maps). The full-screen button takes `frame`
 * there, so the legend drawn over the map goes with it.
 */
export function createMap(container: HTMLElement, frame: HTMLElement | null): MapLibreMap | null {
  let map: MapLibreMap;
  try {
    map = new MapLibreMap({ container, style: MAP_STYLE, bounds: POLAND, fitBoundsOptions: { padding: 16 }, maxBounds: POLAND_LIMIT, locale: LOCALE });
  } catch {
    return null;
  }
  ignoreMissingStyleIcons(map);
  map.once("style.load", () => namePlacesInPolish(map));
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new FullscreenControl(frame ? { container: frame } : {}), "top-right");
  return map;
}

/**
 * The OpenFreeMap "liberty" style names a few icons its sprite does not have (recycling, gate, brownfield,
 * bollard, ...), and MapLibre warns in the console for each one. They are minor base-map details, so stand in
 * a transparent pixel for any icon the style asks for and does not ship.
 */
function ignoreMissingStyleIcons(map: MapLibreMap): void {
  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}

/** The style prefers English names ("Warsaw", "Poland"); a Polish site says "Warszawa", "Polska" and "Niemcy". */
function namePlacesInPolish(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol" || !JSON.stringify(map.getLayoutProperty(layer.id, "text-field") ?? "").includes("name_en")) continue;
    map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:pl"], ["get", "name"]]);
  }
}

/**
 * A white veil over everything outside Poland, so the eye stays on the country the data is about. It lies above the
 * base map (its labels too) and under all our layers, which are added after it. The outline is Natural Earth 1:10m
 * (public domain) simplified to about 200 m, so close to the border the veil thins out.
 */
function dimOutsidePoland(map: MapLibreMap): void {
  map.addSource("poza-polska", { type: "geojson", data: new URL("/poza-polska.geojson", window.location.origin).href });
  map.addLayer({ id: "poza-polska", type: "fill", source: "poza-polska", paint: { "fill-color": "#ffffff", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 10, 0.55, 14, 0.35] } });
}

/**
 * Creates the map once the component is on the page and removes it when the component goes. `onLoad` adds our
 * sources and layers; it runs once, so it should talk to the component through refs. Declare this before the
 * component's own effects: they run in order, so by then `map.current` is set (or the map could not be drawn).
 */
export function useMapLibre(onLoad: (map: MapLibreMap) => void) {
  const frame = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const load = useRef(onLoad);
  const [drawable, setDrawable] = useState(canDrawMap);

  useEffect(() => {
    if (!drawable || !container.current) return;
    const created = createMap(container.current, frame.current);
    if (!created) {
      // The browser reported WebGL2 and still refused a context.
      setDrawable(false);
      return;
    }
    map.current = created;
    created.on("load", () => {
      dimOutsidePoland(created);
      load.current(created);
    });
    return () => {
      map.current = null;
      created.remove();
    };
  }, [drawable]);

  return { frame, container, map, drawable };
}

/** Runs `apply` now if `source` (added on "load") is on the map, otherwise right after the map has loaded. */
export function whenLoaded(map: MapLibreMap, source: string, apply: () => void): void {
  if (map.getSource(source)) apply();
  else map.once("load", apply);
}

/** Replaces the data of one of our GeoJSON sources. */
export function setData(map: MapLibreMap, source: string, data: SourceData): void {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

/** A hand cursor over the layers people can click. */
export function pointerOver(map: MapLibreMap, layers: string[]): void {
  for (const layer of layers) {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
}

export const pointFeature = (point: { lat: number; lon: number }, properties: Record<string, number | string> = {}): SourceData => ({
  type: "Feature",
  properties,
  geometry: { type: "Point", coordinates: [point.lon, point.lat] },
});
export const lineFeature = (coordinates: [number, number][]): SourceData => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });
