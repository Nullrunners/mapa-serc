"use client";

import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api/client";

// maplibre-gl 6 looks for its worker next to its own module (import.meta.url). Once Turbopack bundles it
// into a chunk that file is not there, so the workers fail to load. Point it at the worker explicitly;
// `new URL(..., import.meta.url)` makes Turbopack emit the file as a static asset.
setWorkerUrl(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const POLAND: [number, number, number, number] = [14.1, 49.0, 24.2, 54.9];

const LAYERS = [
  { id: "official", color: "#0052a5", label: "urzędowe" },
  { id: "community", color: "#6b7280", label: "niepotwierdzone" },
] as const;

/** MapLibre needs WebGL2. Without it the constructor throws, and an uncaught error here would take the list down too. */
function canDrawMap(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export interface AedMapProps {
  /** Show the unconfirmed OpenStreetMap layer. */
  showCommunity: boolean;
  /** Point the list is sorted from; the map flies there. */
  focus: { lat: number; lon: number } | null;
  onSelect: (id: string) => void;
}

/**
 * The map is an addition to the list next to it, not a replacement: everything it shows can be reached
 * from the list with a keyboard. Points come as two clustered GeoJSON sources straight from the API.
 */
export default function AedMap({ showCommunity, focus, onSelect }: AedMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

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
          const id = event.features?.[0]?.properties?.id as string | undefined;
          if (id) selectRef.current(id);
        });
        for (const suffix of ["clusters", "points"]) {
          map.on("mouseenter", `${layer.id}-${suffix}`, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", `${layer.id}-${suffix}`, () => (map.getCanvas().style.cursor = ""));
        }
      }
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
    if (focus) mapRef.current?.flyTo({ center: [focus.lon, focus.lat], zoom: 14 });
  }, [focus]);

  if (!drawable) {
    return (
      <div className="flex h-full min-h-[420px] w-full items-center justify-center rounded border border-line bg-gov-light p-6 text-center">
        <p className="max-w-sm">Ta przeglądarka nie potrafi wyświetlić mapy. Lista urządzeń działa bez niej: wpisz miejscowość albo ulicę w wyszukiwarce.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded border border-line">
      <div ref={container} className="absolute inset-0" role="region" aria-label="Mapa defibrylatorów AED. Te same urządzenia są na liście obok." />
      <ul className="absolute bottom-2 left-2 flex gap-3 rounded bg-white/95 px-2 py-1 text-xs shadow" aria-label="Legenda mapy">
        {LAYERS.filter((layer) => layer.id === "official" || showCommunity).map((layer) => (
          <li key={layer.id} className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-3 rounded-full border-2 border-white" style={{ background: layer.color, boxShadow: "0 0 0 1px #6b7280" }} />
            {layer.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
