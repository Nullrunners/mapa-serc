"use client";

import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { MapFrame, MapUnavailable } from "@/components/map-frame";
import { API_URL, type GapsPlace } from "@/lib/api/client";
import { count } from "@/lib/format";
import { outsideOf, type Area, type Ring } from "@/lib/gaps-area";
import { EMPTY, pointerOver, setData, useMapLibre, whenLoaded, type SourceData } from "@/lib/maplibre";
import { startDraw, type Drawn } from "./draw";
import type { Grid } from "./hooks";
import { FAINT, LEVELS, SCALE, type MapView, type Tool } from "./shared";

/** By the tone each hexagon got with the scale of its own level (toneOf): nobody without a device, no colour. */
const FILL = ["match", ["get", "tone"], 1, FAINT, 2, SCALE[0], 3, SCALE[1], 4, SCALE[2], 5, SCALE[3], 6, SCALE[4], "rgba(0,0,0,0)"] as ExpressionSpecification;

const FIT = { padding: 24, duration: 0 };

export interface GapsMapProps {
  /** The hexagons of the level that suits the zoom: smaller as the map comes closer. */
  grid: Grid | null;
  area: Area | null;
  places: GapsPlace[];
  selected: number | null;
  onSelect: (rank: number) => void;
  onView: (view: MapView) => void;
  tool: Tool;
  onDrawn: (drawn: Drawn) => void;
  onToolCancel: () => void;
  /** Drawn over the map, and full screen with it: the selection tools. */
  children?: ReactNode;
}

/** What the layers, added once, need to know of the component as it is now. */
interface Live {
  props: GapsMapProps;
  /** The map is to keep the area in view (after a resize too) until the person moves it. */
  follow: boolean;
}

/**
 * From the bottom: the hexagons and the veil outside the analysed area, both under the street names; the names; then
 * the outline of the area, the shape being drawn, known devices and the numbered places on top.
 */
function addLayers(map: MapLibreMap, live: RefObject<Live>) {
  // North stays up: a rectangle on the screen is then a rectangle on the map.
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  const report = () => {
    const bounds = map.getBounds();
    const round = (value: number) => Number(value.toFixed(4));
    live.current.props.onView({ bbox: [round(bounds.getWest()), round(bounds.getSouth()), round(bounds.getEast()), round(bounds.getNorth())], zoom: map.getZoom() });
  };
  map.on("moveend", report);
  map.on("movestart", (event) => {
    if (event.originalEvent) live.current.follow = false;
  });
  // The panel grows when an area is analysed and the map gets narrower: keep the area in view.
  map.on("resize", () => {
    const { area } = live.current.props;
    if (live.current.follow && area) map.fitBounds(area.bbox, FIT);
  });

  const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;

  map.addSource("hexes", { type: "geojson", data: EMPTY });
  // Lighter when zoomed in, so streets and buildings stay readable under the colour.
  map.addLayer({ id: "hexes-fill", type: "fill", source: "hexes", paint: { "fill-color": FILL, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.65, 16, 0.35] } }, firstLabel);
  map.addLayer({ id: "hexes-line", type: "line", source: "hexes", minzoom: 13, paint: { "line-color": "#7b8591", "line-width": 0.5, "line-opacity": 0.35 } }, firstLabel);

  map.addSource("outside", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "outside-fill", type: "fill", source: "outside", paint: { "fill-color": "#ffffff", "fill-opacity": 0.65 } }, firstLabel);

  map.addSource("area", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#1b1b1b", "line-width": 2 } });

  map.addSource("draft", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "draft-fill", type: "fill", source: "draft", paint: { "fill-color": "#0052a5", "fill-opacity": 0.12 } });
  map.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#0052a5", "line-width": 2, "line-dasharray": [2, 1] } });

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
    if (rank !== undefined) live.current.props.onSelect(rank);
  });
  pointerOver(map, ["places-circle"]);
  report();
}

const polygon = (ring: Ring): SourceData => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });

/** The map of gaps. Everything on it is also in the panel next to it: the numbers, the places and their reports. */
export default function GapsMap(props: GapsMapProps) {
  const { grid, area, places, selected, tool, children } = props;
  const live = useRef<Live>({ props, follow: false });
  useEffect(() => {
    live.current.props = props;
  });

  const { frame, container, map: mapRef, drawable } = useMapLibre((map) => addLayers(map, live));

  const hexes = grid?.hexes;
  useEffect(() => {
    const map = mapRef.current;
    if (map) whenLoaded(map, "hexes", () => setData(map, "hexes", (hexes ?? EMPTY) as SourceData));
  }, [mapRef, hexes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenLoaded(map, "area", () => {
      setData(map, "area", area ? { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: area.outline } } : EMPTY);
      setData(map, "outside", area ? outsideOf(area.outline) : EMPTY);
      live.current.follow = area !== null;
      if (area) map.fitBounds(area.bbox, FIT);
    });
  }, [mapRef, area]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || tool === "move") return;
    const stop = startDraw(map, tool, {
      onDraft: (ring) => setData(map, "draft", ring ? polygon(ring) : EMPTY),
      onDone: (drawn) => live.current.props.onDrawn(drawn),
      onCancel: () => live.current.props.onToolCancel(),
    });
    return stop;
  }, [mapRef, tool]);

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
      if (!place) return;
      live.current.follow = false;
      map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 15) });
    });
  }, [mapRef, selected, places]);

  if (!drawable)
    return <MapUnavailable>Ta przeglądarka nie wyświetli mapy. Wybierz miasto albo gminę w panelu obok.</MapUnavailable>;

  const level = grid?.level ?? LEVELS[0]!;
  const { steps } = level;
  const finest = level === LEVELS.at(-1);
  return (
    <MapFrame frameRef={frame} containerRef={container} label="Mapa luk w dostępie do defibrylatorów. Te same liczby i miejsca są w panelu obok.">
      {/* Top left: the tools, then the legend. The zoom buttons take the top right and the credits the bottom, which
          MapLibre keeps unfolded on a narrow map until it is dragged by hand. */}
      <div className="@container pointer-events-none absolute top-2 right-12 left-2 flex flex-col items-start gap-1.5">
        {children}
        <div role="group" aria-label="Legenda mapy" className="pointer-events-auto max-w-xs rounded-md bg-white/95 px-2.5 py-1.5 text-xs shadow-sm">
          <p className="mb-1">
            <span className="font-semibold">Mieszkańcy bez AED w pobliżu</span> <span className="text-muted">na {level.km2} km²</span>
          </p>
          <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
            <li className="flex items-center gap-1">
              <span aria-hidden className="inline-block size-3 rounded-sm border border-line" style={{ background: FAINT }} />
              poniżej {count(steps[0])}
            </li>
            {SCALE.map((color, index) => (
              <li key={color} className="flex items-center gap-1">
                <span aria-hidden className="inline-block size-3 rounded-sm border border-line" style={{ background: color }} />
                {index < SCALE.length - 1 ? `${count(steps[index]!)}–${count(steps[index + 1]!)}` : `${count(steps[index]!)}+`}
              </li>
            ))}
          </ul>
          {/* On a phone the map has a part of the screen only; the note would cover too much of it. */}
          <p className="mt-1 hidden text-muted md:block">
            {finest ? "Bez koloru: wszyscy mają AED w pobliżu." : "Przybliż, a sześciokąty się zmniejszą."}
          </p>
        </div>
      </div>
    </MapFrame>
  );
}
