"use client";

import { Map as MapLibreMap, NavigationControl, type ExpressionSpecification, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { API_URL, type GapsPlace, type GapsView } from "@/lib/api/client";
import { canDrawMap, ignoreMissingStyleIcons, MAP_STYLE, POLAND } from "@/lib/maplibre";

/** One hue from light to dark, so the scale reads without telling red from green. */
export const SCALE = ["#fde0dd", "#fbb4b9", "#f768a1", "#c51b8a", "#7a0177"] as const;
/** Residents of a small hexagon (about 0.1 km²) without a device in reach, counting the hours of the week. */
export const HEX_STEPS = [10, 50, 150, 400, 800] as const;
/** Residents of a large hexagon (about 36 km²) without a device they can reach at night. */
export const AREA_STEPS = [500, 2000, 5000, 15000, 50000] as const;
/** Below this zoom the country is shown in large hexagons. */
export const DETAIL_ZOOM = 10;

const ramp = (property: ExpressionSpecification, steps: readonly number[]): ExpressionSpecification =>
  ["step", property, "rgba(0,0,0,0)", steps[0]!, SCALE[0], steps[1]!, SCALE[1], steps[2]!, SCALE[2], steps[3]!, SCALE[3], steps[4]!, SCALE[4]] as ExpressionSpecification;

type Data = Parameters<GeoJSONSource["setData"]>[0];
const NOTHING: Data = { type: "FeatureCollection", features: [] };

export interface MapView {
  bbox: [number, number, number, number];
  zoom: number;
}

export interface GapsMapProps {
  hexes: GapsView["hexes"] | null;
  places: GapsPlace[];
  selected: number | null;
  onSelect: (rank: number) => void;
  onView: (view: MapView) => void;
  /** Fit the map to this box whenever `seq` changes. */
  fitTo: { bbox: [number, number, number, number]; seq: number } | null;
}

function whenReady(map: MapLibreMap, apply: () => void) {
  if (map.getSource("places")) apply();
  else map.once("load", apply);
}

/**
 * The map of gaps. Everything on it is also on the list next to it: the numbers, the places and their reports.
 */
export default function GapsMap({ hexes, places, selected, onSelect, onView, fitTo }: GapsMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const handlers = useRef({ onSelect, onView });
  useEffect(() => {
    handlers.current = { onSelect, onView };
  }, [onSelect, onView]);
  const [drawable, setDrawable] = useState(canDrawMap);
  const [zoom, setZoom] = useState(5);

  useEffect(() => {
    if (!drawable || !container.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({ container: container.current, style: MAP_STYLE, bounds: POLAND, fitBoundsOptions: { padding: 16 } });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrawable(false);
      return;
    }
    mapRef.current = map;
    ignoreMissingStyleIcons(map);
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const report = () => {
      const bounds = map.getBounds();
      const round = (value: number) => Number(value.toFixed(4));
      setZoom(map.getZoom());
      handlers.current.onView({ bbox: [round(bounds.getWest()), round(bounds.getSouth()), round(bounds.getEast()), round(bounds.getNorth())], zoom: map.getZoom() });
    };
    map.on("moveend", report);

    map.on("load", () => {
      // Put the hexagons under the street names of the base map, so the map stays readable.
      const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;

      map.addSource("overview", { type: "geojson", data: `${API_URL}/v1/gaps/overview.geojson` });
      map.addLayer({ id: "overview-fill", type: "fill", source: "overview", maxzoom: DETAIL_ZOOM, paint: { "fill-color": ramp(["get", "noNight"], AREA_STEPS), "fill-opacity": 0.65 } }, firstLabel);

      map.addSource("hexes", { type: "geojson", data: NOTHING });
      // Lighter when zoomed in, so streets and buildings stay readable under the colour.
      map.addLayer({ id: "hexes-fill", type: "fill", source: "hexes", paint: { "fill-color": ramp(["get", "uncovered"], HEX_STEPS), "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 0.3] } }, firstLabel);
      map.addLayer({ id: "hexes-line", type: "line", source: "hexes", minzoom: 13, paint: { "line-color": "#ffffff", "line-width": 0.5, "line-opacity": 0.6 } }, firstLabel);

      map.addSource("aed", { type: "geojson", data: `${API_URL}/v1/aed.geojson?layer=all` });
      map.addLayer({ id: "aed-points", type: "circle", source: "aed", minzoom: 11, paint: { "circle-color": "#0052a5", "circle-radius": 4, "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff" } });

      map.addSource("selected", { type: "geojson", data: NOTHING });
      map.addLayer({ id: "selected-line", type: "line", source: "selected", paint: { "line-color": "#1b1b1b", "line-width": 3 } });

      map.addSource("places", { type: "geojson", data: NOTHING });
      map.addLayer({ id: "places-circle", type: "circle", source: "places", paint: { "circle-color": "#1b1b1b", "circle-radius": 12, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
      map.addLayer({
        id: "places-label",
        type: "symbol",
        source: "places",
        layout: { "text-field": ["to-string", ["get", "rank"]], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });
      map.on("click", "places-circle", (event) => {
        const rank = event.features?.[0]?.properties?.rank as number | undefined;
        if (rank !== undefined) handlers.current.onSelect(rank);
      });
      map.on("mouseenter", "places-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "places-circle", () => (map.getCanvas().style.cursor = ""));
      report();
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [drawable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, () => (map.getSource("hexes") as GeoJSONSource | undefined)?.setData((hexes ?? NOTHING) as Data));
  }, [hexes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data: Data = {
      type: "FeatureCollection",
      features: places.map((place) => ({ type: "Feature", properties: { rank: place.rank }, geometry: { type: "Point", coordinates: [place.lon, place.lat] } })),
    };
    whenReady(map, () => (map.getSource("places") as GeoJSONSource | undefined)?.setData(data));
  }, [places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const place = places.find((candidate) => candidate.rank === selected);
    whenReady(map, () => {
      (map.getSource("selected") as GeoJSONSource | undefined)?.setData(place ? { type: "Feature", properties: {}, geometry: place.boundary } : NOTHING);
      if (place) map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 15) });
    });
  }, [selected, places]);

  useEffect(() => {
    if (fitTo) mapRef.current?.fitBounds(fitTo.bbox, { padding: 8, duration: 800 });
  }, [fitTo]);

  if (!drawable) {
    return (
      <div className="flex h-full min-h-[420px] w-full items-center justify-center rounded border border-line bg-gov-light p-6 text-center">
        <p className="max-w-sm">Ta przeglądarka nie potrafi wyświetlić mapy. Wybierz miasto z listy obok: liczby i miejsca na nowe defibrylatory pokażemy bez mapy.</p>
      </div>
    );
  }

  const detail = zoom >= DETAIL_ZOOM;
  const steps = detail ? HEX_STEPS : AREA_STEPS;
  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded border border-line">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label="Mapa luk w dostępie do defibrylatorów. Te same liczby i miejsca są na liście obok." />
      </div>
      <div className="absolute bottom-2 left-2 max-w-[18rem] rounded bg-white/95 px-2 py-1.5 text-xs shadow" aria-label="Legenda mapy" role="group">
        <p className="mb-1 font-semibold">{detail ? "Mieszkańcy bez AED w pobliżu, z uwzględnieniem godzin" : "Mieszkańcy bez AED dostępnego w nocy"}</p>
        <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
          {SCALE.map((color, index) => (
            <li key={color} className="flex items-center gap-1">
              <span aria-hidden className="inline-block size-3 rounded-sm border border-line" style={{ background: color }} />
              {index < SCALE.length - 1 ? `${steps[index]!.toLocaleString("pl-PL")}–${steps[index + 1]!.toLocaleString("pl-PL")}` : `${steps[index]!.toLocaleString("pl-PL")}+`}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-muted">{detail ? "Sześciokąt ma ok. 0,1 km². Niebieskie kropki to znane defibrylatory." : "Sześciokąt ma ok. 36 km². Przybliż, żeby zobaczyć ulice."}</p>
      </div>
    </div>
  );
}
