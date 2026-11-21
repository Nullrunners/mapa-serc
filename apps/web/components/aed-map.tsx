"use client";

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Picked } from "@/components/device-list";
import { MapFrame, MapLegend, MapUnavailable } from "@/components/map-frame";
import { API_URL } from "@/lib/api/client";
import { EMPTY, lineFeature, pointFeature, pointerOver, setData, useMapLibre, whenLoaded } from "@/lib/maplibre";
import type { Point } from "@/lib/route";

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

/**
 * Devices as two clustered GeoJSON sources straight from the API, the way to one of them, where the person is,
 * and a ring around the device open in the panel.
 */
function addLayers(map: MapLibreMap, onSelect: (picked: Picked) => void) {
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
      onSelect({ id, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) });
    });
    pointerOver(map, [`${layer.id}-clusters`, `${layer.id}-points`]);
  }

  // The way to the device, under the points so the devices on it stay clickable.
  const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
  map.addSource("walk", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "walk-casing", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": "#ffffff", "line-width": 9 } }, "official-clusters");
  map.addLayer({ id: "walk-line", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": WALK_COLOR, "line-width": 5 } }, "official-clusters");
  // When no route was found only the direction is shown, dashed so it does not pass for a path.
  map.addSource("walk-straight", { type: "geojson", data: EMPTY });
  map.addLayer(
    { id: "walk-straight", type: "line", source: "walk-straight", layout: lineLayout, paint: { "line-color": WALK_COLOR, "line-width": 4, "line-dasharray": [1, 2] } },
    "official-clusters",
  );

  // Where the person is.
  map.addSource("me", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "me-dot", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": WALK_COLOR, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });

  // A ring around the device shown in the panel, drawn above both layers.
  map.addSource("selected", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "selected-ring", type: "circle", source: "selected", paint: { "circle-radius": 12, "circle-opacity": 0, "circle-stroke-width": 4, "circle-stroke-color": "#1b1b1b" } });
}

export default function AedMap({ showCommunity, focus, walk, selected, onSelect }: AedMapProps) {
  const selectRef = useRef(onSelect);
  const walkRef = useRef(walk);
  useEffect(() => {
    selectRef.current = onSelect;
    walkRef.current = walk;
  }, [onSelect, walk]);

  const { frame, container, map: mapRef, drawable } = useMapLibre((map) => addLayers(map, (picked) => selectRef.current(picked)));

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenLoaded(map, "community", () => {
      for (const suffix of ["clusters", "count", "points"]) map.setLayoutProperty(`community-${suffix}`, "visibility", showCommunity ? "visible" : "none");
    });
  }, [mapRef, showCommunity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenLoaded(map, "me", () => setData(map, "me", focus ? pointFeature(focus) : EMPTY));
    if (focus) map.flyTo({ center: [focus.lon, focus.lat], zoom: 14 });
  }, [mapRef, focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenLoaded(map, "walk", () => {
      const ends: [number, number][] = walk ? [[walk.from.lon, walk.from.lat], [walk.to.lon, walk.to.lat]] : [];
      const route = walk && Array.isArray(walk.line) ? walk.line : null;
      setData(map, "walk", route ? lineFeature(route) : EMPTY);
      setData(map, "walk-straight", walk?.line === "straight" ? lineFeature(ends) : EMPTY);
      if (!walk) return;
      // Both ends in view: where the person stands and where the device is, and the whole way between them.
      const points = route ?? ends;
      const lons = points.map(([lon]) => lon);
      const lats = points.map(([, lat]) => lat);
      map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], { padding: 60, maxZoom: 17 });
    });
  }, [mapRef, walk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenLoaded(map, "selected", () => {
      setData(map, "selected", selected ? pointFeature(selected) : EMPTY);
      // With the way to this device on the map, the map already frames both ends; do not zoom in on just one.
      const walkingThere = walkRef.current?.to.lat === selected?.lat && walkRef.current?.to.lon === selected?.lon;
      if (selected && !walkingThere) map.flyTo({ center: [selected.lon, selected.lat], zoom: Math.max(map.getZoom(), 15) });
    });
  }, [mapRef, selected]);

  if (!drawable) return <MapUnavailable>Ta przeglądarka nie potrafi wyświetlić mapy. Lista urządzeń działa bez niej: wpisz miejscowość albo ulicę w wyszukiwarce.</MapUnavailable>;

  return (
    <MapFrame frameRef={frame} containerRef={container} label="Mapa defibrylatorów AED. Te same urządzenia są na liście obok.">
      <MapLegend>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
          {LAYERS.filter((layer) => layer.id === "official" || showCommunity).map((layer) => (
            <li key={layer.id} className="flex items-center gap-1.5">
              <Dot color={layer.color} />
              {layer.label}
            </li>
          ))}
          {focus && (
            <li className="flex items-center gap-1.5">
              <Dot color={WALK_COLOR} />
              tu jesteś
            </li>
          )}
          {walk && walk.line !== "loading" && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className={`inline-block w-4 border-t-4 ${walk.line === "straight" ? "border-dotted" : ""}`} style={{ borderColor: WALK_COLOR }} />
              {walk.line === "straight" ? "kierunek (trasy nie udało się wyznaczyć)" : "trasa pieszo"}
            </li>
          )}
        </ul>
      </MapLegend>
    </MapFrame>
  );
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-3 rounded-full border-2 border-white" style={{ background: color, boxShadow: "0 0 0 1px #6b7280" }} />;
}
