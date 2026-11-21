"use client";

import { Map as MapLibreMap, NavigationControl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api/client";
import { canDrawMap, ignoreMissingStyleIcons, MAP_STYLE as STYLE, POLAND } from "@/lib/maplibre";
import type { Point } from "@/lib/route";
import type { Picked } from "./aed-details";

const LAYERS = [
  { id: "official", color: "#0052a5", label: "urzędowe" },
  { id: "community", color: "#6b7280", label: "niepotwierdzone" },
] as const;

const WALK_COLOR = "#b00020";

/** The way from the person to a device: the walking route, or a straight dashed line when no route could be found. */
export interface WalkOnMap {
  from: Point;
  to: Point;
  line: [number, number][] | "loading" | "straight";
}

export interface AedMapProps {
  /** Show the unconfirmed OpenStreetMap layer. */
  showCommunity: boolean;
  /** The person's position: the list is sorted from it, the map flies there and marks it. */
  focus: Point | null;
  /** The way to the device the person should run to, drawn on the map. */
  walk: WalkOnMap | null;
  /** Device shown in the panel next to the map; it gets a ring and the map flies to it. */
  selected: Picked | null;
  onSelect: (picked: Picked) => void;
}

type SourceData = Parameters<GeoJSONSource["setData"]>[0];
const NOTHING: SourceData = { type: "FeatureCollection", features: [] };
const pointData = (point: Point): SourceData => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [point.lon, point.lat] } });
const lineData = (coordinates: [number, number][]): SourceData => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });

/** Runs `apply` now if our sources are on the map, otherwise right after they are added on "load". */
function whenReady(map: MapLibreMap, apply: () => void) {
  if (map.getSource("selected")) apply();
  else map.once("load", apply);
}

/**
 * The map is an addition to the list next to it, not a replacement: everything it shows can be reached
 * from the list with a keyboard. Points come as two clustered GeoJSON sources straight from the API.
 */
export default function AedMap({ showCommunity, focus, walk, selected, onSelect }: AedMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectRef = useRef(onSelect);
  const walkRef = useRef(walk);
  useEffect(() => {
    selectRef.current = onSelect;
    walkRef.current = walk;
  }, [onSelect, walk]);

  const [drawable, setDrawable] = useState(canDrawMap);

  useEffect(() => {
    if (!drawable || !container.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({ container: container.current, style: STYLE, bounds: POLAND, fitBoundsOptions: { padding: 16 } });
    } catch {
      // The browser reported WebGL2 and still refused a context (blocked driver, too many open maps).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrawable(false);
      return;
    }
    mapRef.current = map;
    ignoreMissingStyleIcons(map);
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      for (const layer of LAYERS) {
        map.addSource(layer.id, { type: "geojson", data: `${API_URL}/v1/aed.geojson?layer=${layer.id}`, cluster: true, clusterRadius: 45, clusterMaxZoom: 13 });
        map.addLayer({
          id: `${layer.id}-clusters`,
          type: "circle",
          source: layer.id,
          filter: ["has", "point_count"],
          paint: { "circle-color": layer.color, "circle-opacity": 0.85, "circle-radius": ["step", ["get", "point_count"], 14, 50, 18, 500, 24], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
        });
        map.addLayer({
          id: `${layer.id}-count`,
          type: "symbol",
          source: layer.id,
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: `${layer.id}-points`,
          type: "circle",
          source: layer.id,
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-color": layer.color, "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
        });

        map.on("click", `${layer.id}-clusters`, async (event) => {
          const feature = event.features?.[0];
          const clusterId = feature?.properties?.cluster_id as number | undefined;
          if (!feature || clusterId === undefined || feature.geometry.type !== "Point") return;
          const zoom = await (map.getSource(layer.id) as GeoJSONSource).getClusterExpansionZoom(clusterId);
          map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
        });
        map.on("click", `${layer.id}-points`, (event) => {
          const feature = event.features?.[0];
          const id = feature?.properties?.id as string | undefined;
          if (!id || feature?.geometry.type !== "Point") return;
          const [lon, lat] = feature.geometry.coordinates;
          // Tile geometry carries float noise; 6 decimals is ~10 cm, more than any record holds.
          selectRef.current({ id, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) });
        });
        for (const suffix of ["clusters", "points"]) {
          map.on("mouseenter", `${layer.id}-${suffix}`, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", `${layer.id}-${suffix}`, () => (map.getCanvas().style.cursor = ""));
        }
      }

      // The way to the device, under the points so the devices on it stay clickable.
      map.addSource("walk", { type: "geojson", data: NOTHING });
      const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
      map.addLayer({ id: "walk-casing", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": "#ffffff", "line-width": 9 } }, "official-clusters");
      map.addLayer({ id: "walk-line", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": WALK_COLOR, "line-width": 5 } }, "official-clusters");
      // When no route was found only the direction is shown, dashed so it does not pass for a path.
      map.addSource("walk-straight", { type: "geojson", data: NOTHING });
      map.addLayer(
        { id: "walk-straight", type: "line", source: "walk-straight", layout: lineLayout, paint: { "line-color": WALK_COLOR, "line-width": 4, "line-dasharray": [1, 2] } },
        "official-clusters",
      );

      // Where the person is.
      map.addSource("me", { type: "geojson", data: NOTHING });
      map.addLayer({ id: "me-dot", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": WALK_COLOR, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });

      // A ring around the device shown in the panel, drawn above both layers.
      map.addSource("selected", { type: "geojson", data: NOTHING });
      map.addLayer({
        id: "selected-ring",
        type: "circle",
        source: "selected",
        paint: { "circle-radius": 12, "circle-opacity": 0, "circle-stroke-width": 4, "circle-stroke-color": "#1b1b1b" },
      });
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [drawable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const suffix of ["clusters", "count", "points"]) {
        if (map.getLayer(`community-${suffix}`)) map.setLayoutProperty(`community-${suffix}`, "visibility", showCommunity ? "visible" : "none");
      }
    };
    if (map.isStyleLoaded() && map.getLayer("community-points")) apply();
    else map.once("idle", apply);
  }, [showCommunity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, () => (map.getSource("me") as GeoJSONSource | undefined)?.setData(focus ? pointData(focus) : NOTHING));
    if (focus) map.flyTo({ center: [focus.lon, focus.lat], zoom: 14 });
  }, [focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, () => {
      const ends: [number, number][] = walk ? [[walk.from.lon, walk.from.lat], [walk.to.lon, walk.to.lat]] : [];
      const route = walk && Array.isArray(walk.line) ? walk.line : null;
      (map.getSource("walk") as GeoJSONSource | undefined)?.setData(route ? lineData(route) : NOTHING);
      (map.getSource("walk-straight") as GeoJSONSource | undefined)?.setData(walk?.line === "straight" ? lineData(ends) : NOTHING);
      if (!walk) return;
      // Both ends in view: where the person stands and where the device is, and the whole way between them.
      const points = route ?? ends;
      const lons = points.map(([lon]) => lon);
      const lats = points.map(([, lat]) => lat);
      map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], { padding: 60, maxZoom: 17 });
    });
  }, [walk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, () => {
      (map.getSource("selected") as GeoJSONSource | undefined)?.setData(selected ? pointData(selected) : NOTHING);
      // With the way to this device on the map, the map already frames both ends; do not zoom in on just one.
      const walkingThere = walkRef.current?.to.lat === selected?.lat && walkRef.current?.to.lon === selected?.lon;
      if (selected && !walkingThere) map.flyTo({ center: [selected.lon, selected.lat], zoom: Math.max(map.getZoom(), 15) });
    });
  }, [selected]);

  if (!drawable) {
    return (
      <div className="flex h-full min-h-[420px] w-full items-center justify-center rounded border border-line bg-gov-light p-6 text-center">
        <p className="max-w-sm">Ta przeglądarka nie potrafi wyświetlić mapy. Lista urządzeń działa bez niej: wpisz miejscowość albo ulicę w wyszukiwarce.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded border border-line">
      {/* MapLibre's own CSS sets `.maplibregl-map { position: relative }` outside any cascade layer, so it beats
          Tailwind's layered `absolute` and the map collapses to 0 px. The positioning lives on a wrapper instead. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label="Mapa defibrylatorów AED. Te same urządzenia są na liście obok." />
      </div>
      <ul className="absolute bottom-2 left-2 mr-2 flex flex-wrap gap-x-3 gap-y-0.5 rounded bg-white/95 px-2 py-1 text-xs shadow" aria-label="Legenda mapy">
        {LAYERS.filter((layer) => layer.id === "official" || showCommunity).map((layer) => (
          <li key={layer.id} className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-3 rounded-full border-2 border-white" style={{ background: layer.color, boxShadow: "0 0 0 1px #6b7280" }} />
            {layer.label}
          </li>
        ))}
        {focus && (
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-3 rounded-full border-2 border-white" style={{ background: WALK_COLOR, boxShadow: "0 0 0 1px #6b7280" }} />
            tu jesteś
          </li>
        )}
        {walk && walk.line !== "loading" && (
          <li className="flex items-center gap-1">
            <span aria-hidden className={`inline-block w-4 border-t-4 ${walk.line === "straight" ? "border-dotted" : ""}`} style={{ borderColor: WALK_COLOR }} />
            {walk.line === "straight" ? "kierunek (trasy nie udało się wyznaczyć)" : "trasa pieszo"}
          </li>
        )}
      </ul>
    </div>
  );
}
