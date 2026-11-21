"use client";

import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type RefObject } from "react";
import { MapFrame, MapLegend, MapUnavailable } from "@/components/map-frame";
import { API_URL, type GapsPlace, type GapsView } from "@/lib/api/client";
import { count } from "@/lib/format";
import { EMPTY, pointerOver, setData, useMapLibre, whenLoaded, type SourceData } from "@/lib/maplibre";

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

type Handlers = RefObject<Pick<GapsMapProps, "onSelect" | "onView">>;

/** The country in large hexagons, the analysed area in small ones, known devices and the numbered places. */
function addLayers(map: MapLibreMap, handlers: Handlers, setZoom: (zoom: number) => void) {
  const report = () => {
    const bounds = map.getBounds();
    const round = (value: number) => Number(value.toFixed(4));
    setZoom(map.getZoom());
    handlers.current.onView({ bbox: [round(bounds.getWest()), round(bounds.getSouth()), round(bounds.getEast()), round(bounds.getNorth())], zoom: map.getZoom() });
  };
  map.on("moveend", report);

  // Put the hexagons under the street names of the base map, so the map stays readable.
  const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;

  map.addSource("overview", { type: "geojson", data: `${API_URL}/v1/gaps/overview.geojson` });
  map.addLayer({ id: "overview-fill", type: "fill", source: "overview", maxzoom: DETAIL_ZOOM, paint: { "fill-color": ramp(["get", "noNight"], AREA_STEPS), "fill-opacity": 0.65 } }, firstLabel);

  map.addSource("hexes", { type: "geojson", data: EMPTY });
  // Lighter when zoomed in, so streets and buildings stay readable under the colour.
  map.addLayer({ id: "hexes-fill", type: "fill", source: "hexes", paint: { "fill-color": ramp(["get", "uncovered"], HEX_STEPS), "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 0.3] } }, firstLabel);
  map.addLayer({ id: "hexes-line", type: "line", source: "hexes", minzoom: 13, paint: { "line-color": "#ffffff", "line-width": 0.5, "line-opacity": 0.6 } }, firstLabel);

  map.addSource("aed", { type: "geojson", data: `${API_URL}/v1/aed.geojson?layer=all` });
  map.addLayer({ id: "aed-points", type: "circle", source: "aed", minzoom: 11, paint: { "circle-color": "#0052a5", "circle-radius": 4, "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff" } });

  map.addSource("selected", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "selected-line", type: "line", source: "selected", paint: { "line-color": "#1b1b1b", "line-width": 3 } });

  map.addSource("places", { type: "geojson", data: EMPTY });
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
  pointerOver(map, ["places-circle"]);
  report();
}

/** The map of gaps. Everything on it is also in the panel next to it: the numbers, the places and their reports. */
export default function GapsMap({ hexes, places, selected, onSelect, onView, fitTo }: GapsMapProps) {
  const handlers = useRef({ onSelect, onView });
  useEffect(() => {
    handlers.current = { onSelect, onView };
  }, [onSelect, onView]);
  const [zoom, setZoom] = useState(5);

  const { frame, container, map: mapRef, drawable } = useMapLibre((map) => addLayers(map, handlers, setZoom));

  useEffect(() => {
    const map = mapRef.current;
    if (map) whenLoaded(map, "hexes", () => setData(map, "hexes", (hexes ?? EMPTY) as SourceData));
  }, [mapRef, hexes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data: SourceData = {
      type: "FeatureCollection",
      features: places.map((place) => ({ type: "Feature", properties: { rank: place.rank }, geometry: { type: "Point", coordinates: [place.lon, place.lat] } })),
    };
    whenLoaded(map, "places", () => setData(map, "places", data));
  }, [mapRef, places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const place = places.find((candidate) => candidate.rank === selected);
    whenLoaded(map, "selected", () => {
      setData(map, "selected", place ? { type: "Feature", properties: {}, geometry: place.boundary } : EMPTY);
      if (place) map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 15) });
    });
  }, [mapRef, selected, places]);

  useEffect(() => {
    if (fitTo) mapRef.current?.fitBounds(fitTo.bbox, { padding: 8, duration: 800 });
  }, [mapRef, fitTo]);

  if (!drawable) return <MapUnavailable>Ta przeglądarka nie potrafi wyświetlić mapy. Wybierz miasto z listy obok: liczby i miejsca na nowe defibrylatory pokażemy bez mapy.</MapUnavailable>;

  const detail = zoom >= DETAIL_ZOOM;
  const steps = detail ? HEX_STEPS : AREA_STEPS;
  return (
    <MapFrame frameRef={frame} containerRef={container} label="Mapa luk w dostępie do defibrylatorów. Te same liczby i miejsca są na liście obok.">
      <MapLegend>
        <p className="mb-1 font-semibold">{detail ? "Mieszkańcy bez AED w pobliżu, z uwzględnieniem godzin" : "Mieszkańcy bez AED dostępnego w nocy"}</p>
        <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
          {SCALE.map((color, index) => (
            <li key={color} className="flex items-center gap-1">
              <span aria-hidden className="inline-block size-3 rounded-sm border border-line" style={{ background: color }} />
              {index < SCALE.length - 1 ? `${count(steps[index]!)}–${count(steps[index + 1]!)}` : `${count(steps[index]!)}+`}
            </li>
          ))}
        </ul>
        {/* On a phone the map has half the screen; the note would cover too much of it. */}
        <p className="mt-1 hidden text-muted md:block">{detail ? "Sześciokąt ma ok. 0,1 km². Niebieskie kropki to znane defibrylatory." : "Sześciokąt ma ok. 36 km². Przybliż, żeby zobaczyć ulice."}</p>
      </MapLegend>
    </MapFrame>
  );
}
