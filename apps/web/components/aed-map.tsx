"use client";

import type { GeoJSONSource, Map as MapLibreMap, MapMovementEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Picked } from "@/components/device-list";
import { AED_ICON_IMAGE, AED_ICON_ORDER, AED_KINDS, AedIcon, aedImage, aedImageId } from "@/components/aed-icon";
import { MapFrame, MapLegend, MapUnavailable } from "@/components/map-frame";
import { API_URL } from "@/lib/api/client";
import { EMPTY, lineFeature, pointFeature, pointerOver, setData, useMapLibre, whenLoaded } from "@/lib/maplibre";
import { bearing, type Point } from "@/lib/route";

/** Drawn in this order, so the confirmed devices lie on top of the unconfirmed ones. */
const LAYERS = [{ id: "community" }, { id: "official" }] as const;

/** A group of devices may hold any kind, so it takes the colour of the defibrillator sign. */
const CLUSTER_COLOR = AED_KINDS[0].color;
/** The way to a device lies under all of them, so the devices on it stay clickable. */
const UNDER_DEVICES = `${LAYERS[0].id}-clusters`;

const WALK_COLOR = "#b00020";

/** The way is shown from behind the person, the map leaning back: a little for the whole way, more while they walk it. */
const OVERVIEW_TILT = 45;
const FOLLOW_TILT = 60;
/** Close enough to tell one path from the next. */
const FOLLOW_ZOOM = 17.5;

/** The way from the person to a device: the walking route, or a straight dashed line when no route could be found. */
export interface WalkOnMap {
  from: Point;
  to: Point;
  line: [number, number][] | "loading" | "straight";
}

/** Leading the person along the way: the map stays on them, turned the way they should go. */
export interface GuideOnMap {
  /** Where the person is now. */
  at: Point;
  /** Which way to go from there, in degrees from north; null while there is no way to follow (the map keeps its turn). */
  bearing: number | null;
  /** The part of the way still ahead of them, drawn instead of the whole. */
  rest: [number, number][] | null;
}

export interface AedMapProps {
  /** Show the unconfirmed OpenStreetMap layer. */
  showCommunity: boolean;
  /** The person's position: the list is sorted from it, the map flies there and marks it. */
  focus: Point | null;
  /** The way to the device the person should run to, drawn on the map; the map turns so the device is ahead. */
  walk: WalkOnMap | null;
  /** Set while the person is led along the way. */
  guide: GuideOnMap | null;
  /** Shown over the map in place of the legend: what to do next on the way. */
  banner?: ReactNode;
  /** Device shown in the panel next to the map; it gets a ring and the map flies to it. */
  selected: Picked | null;
  onSelect: (picked: Picked) => void;
}

/**
 * Devices as two clustered GeoJSON sources straight from the API, each one an icon in the colour of who can reach
 * it, the way to one of them, where the person is, and a ring around the device open in the panel.
 */
function addLayers(map: MapLibreMap, onSelect: (picked: Picked) => void) {
  for (const kind of AED_KINDS) {
    const image = aedImage(kind);
    if (image) map.addImage(aedImageId(kind), image, { pixelRatio: 2 });
  }
  for (const layer of LAYERS) {
    map.addSource(layer.id, { type: "geojson", data: `${API_URL}/v1/aed.geojson?layer=${layer.id}`, cluster: true, clusterRadius: 45, clusterMaxZoom: 13 });
    map.addLayer({
      id: `${layer.id}-clusters`,
      type: "circle",
      source: layer.id,
      filter: ["has", "point_count"],
      paint: { "circle-color": CLUSTER_COLOR, "circle-opacity": 0.9, "circle-radius": ["step", ["get", "point_count"], 14, 50, 18, 500, 24], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
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
      type: "symbol",
      source: layer.id,
      filter: ["!", ["has", "point_count"]],
      layout: { "icon-image": AED_ICON_IMAGE, "symbol-sort-key": AED_ICON_ORDER, "icon-allow-overlap": true, "icon-ignore-placement": true },
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

  // The way to the device.
  const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
  map.addSource("walk", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "walk-casing", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": "#ffffff", "line-width": 9 } }, UNDER_DEVICES);
  map.addLayer({ id: "walk-line", type: "line", source: "walk", layout: lineLayout, paint: { "line-color": WALK_COLOR, "line-width": 5 } }, UNDER_DEVICES);
  // When no route was found only the direction is shown, dashed so it does not pass for a path.
  map.addSource("walk-straight", { type: "geojson", data: EMPTY });
  map.addLayer(
    { id: "walk-straight", type: "line", source: "walk-straight", layout: lineLayout, paint: { "line-color": WALK_COLOR, "line-width": 4, "line-dasharray": [1, 2] } },
    UNDER_DEVICES,
  );

  // Where the person is.
  map.addSource("me", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "me-dot", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": WALK_COLOR, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
  // While they are led, an arrow over the dot: it lies on the map and points the way to go.
  const arrow = arrowBadge();
  if (arrow) {
    map.addImage("me-arrow", arrow, { pixelRatio: 2 });
    map.addLayer({
      id: "me-arrow",
      type: "symbol",
      source: "me",
      filter: ["has", "bearing"],
      layout: { "icon-image": "me-arrow", "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
    });
  }

  // A ring around the device shown in the panel, drawn above both layers.
  map.addSource("selected", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "selected-ring", type: "circle", source: "selected", paint: { "circle-radius": 25, "circle-opacity": 0, "circle-stroke-width": 4, "circle-stroke-color": "#1b1b1b" } });
}

/** A round badge with an arrow pointing up, twice the size it is drawn at so it stays sharp on dense screens. */
function arrowBadge(): ImageData | null {
  const size = 88;
  const middle = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.beginPath();
  context.arc(middle, middle, middle - 4, 0, 2 * Math.PI);
  context.fillStyle = WALK_COLOR;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.beginPath();
  context.moveTo(middle, 14);
  context.lineTo(middle + 20, 60);
  context.lineTo(middle, 49);
  context.lineTo(middle - 20, 60);
  context.closePath();
  context.fillStyle = "#ffffff";
  context.fill();
  return context.getImageData(0, 0, size, size);
}

export default function AedMap({ showCommunity, focus, walk, guide, banner, selected, onSelect }: AedMapProps) {
  const guiding = guide !== null;
  const selectRef = useRef(onSelect);
  const walkRef = useRef(walk);
  const guidingRef = useRef(guiding);
  // The last direction of the way, kept for the moments a new way is being looked for.
  const heading = useRef(0);
  useEffect(() => {
    selectRef.current = onSelect;
    walkRef.current = walk;
    guidingRef.current = guiding;
  }, [onSelect, walk, guiding]);

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
    if (guide && guide.bearing !== null) heading.current = guide.bearing;
    const me = guide ? pointFeature(guide.at, { bearing: heading.current }) : focus ? pointFeature(focus) : EMPTY;
    whenLoaded(map, "me", () => setData(map, "me", me));
  }, [mapRef, focus, guide]);

  useEffect(() => {
    const map = mapRef.current;
    // While the person is led, the map follows them on its own.
    if (map && focus && !guidingRef.current) map.flyTo({ center: [focus.lon, focus.lat], zoom: 14 });
  }, [mapRef, focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenLoaded(map, "walk", () => {
      const route = walk && Array.isArray(walk.line) ? walk.line : null;
      // While the person is led, only what is still ahead of them.
      setData(map, "walk", route ? lineFeature(guide?.rest ?? route) : EMPTY);
      const from = guide?.at ?? walk?.from;
      setData(map, "walk-straight", walk?.line === "straight" && from ? lineFeature([[from.lon, from.lat], [walk.to.lon, walk.to.lat]]) : EMPTY);
    });
  }, [mapRef, walk, guide]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || guiding) return;
    whenLoaded(map, "walk", () => {
      if (!walk) {
        // Nothing to walk to any more: north up and seen from above again.
        if (map.getBearing() !== 0 || map.getPitch() !== 0) map.easeTo({ bearing: 0, pitch: 0 });
        return;
      }
      // The whole way in view, seen from behind the person: they are at the bottom and the device is ahead of them.
      const points: [number, number][] = Array.isArray(walk.line) ? walk.line : [[walk.from.lon, walk.from.lat], [walk.to.lon, walk.to.lat]];
      const lons = points.map(([lon]) => lon);
      const lats = points.map(([, lat]) => lat);
      map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], { padding: 60, maxZoom: 17, bearing: bearing(walk.from, walk.to), pitch: OVERVIEW_TILT });
    });
  }, [mapRef, walk, guiding]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenLoaded(map, "selected", () => {
      setData(map, "selected", selected ? pointFeature(selected) : EMPTY);
      // With the way to this device on the map, the map already frames both ends; do not zoom in on just one.
      const walkingThere = walkRef.current?.to.lat === selected?.lat && walkRef.current?.to.lon === selected?.lon;
      if (selected && !walkingThere) map.flyTo({ center: [selected.lon, selected.lat], zoom: Math.max(map.getZoom(), 15), bearing: 0, pitch: 0 });
    });
  }, [mapRef, selected]);

  if (!drawable) return <MapUnavailable>Ta przeglądarka nie potrafi wyświetlić mapy. Lista urządzeń działa bez niej: wpisz miejscowość albo ulicę w wyszukiwarce.</MapUnavailable>;

  return (
    <MapFrame frameRef={frame} containerRef={container} label="Mapa defibrylatorów AED. Te same urządzenia są na liście obok.">
      {guide && <Follow mapRef={mapRef} guide={guide} />}
      {banner ?? (
        <MapLegend>
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {AED_KINDS.map((kind) => (
              <li key={kind.id} className="flex items-center gap-1.5">
                <AedIcon kind={kind} />
                {kind.label}
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
      )}
    </MapFrame>
  );
}

/**
 * Keeps the map on the person while they are led: turned the way they should go, leaning back, with them in its
 * lower part. Moving the map by hand stops that, and a button brings it back.
 */
function Follow({ mapRef, guide }: { mapRef: RefObject<MapLibreMap | null>; guide: GuideOnMap }) {
  const [following, setFollowing] = useState(true);
  // The first move to the person also zooms in; after that their own zoom stays.
  const closeUp = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Our own moves carry no original event; a drag, a turn or a tilt by hand does.
    const pause = (event: MapMovementEvent) => {
      if (event.originalEvent) setFollowing(false);
    };
    const moves = ["dragstart", "rotatestart", "pitchstart"] as const;
    for (const move of moves) map.on(move, pause);
    return () => {
      for (const move of moves) map.off(move, pause);
    };
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !following) return;
    const first = !closeUp.current;
    closeUp.current = true;
    map.easeTo({
      center: [guide.at.lon, guide.at.lat],
      pitch: FOLLOW_TILT,
      // The person in the lower part of the map, so more of the way ahead is in view.
      offset: [0, map.getContainer().clientHeight / 4],
      ...(guide.bearing !== null && { bearing: guide.bearing }),
      // Between two GPS readings the map glides at an even pace.
      ...(first ? { zoom: Math.max(map.getZoom(), FOLLOW_ZOOM), duration: 1200 } : { duration: 1000, easing: (t: number) => t }),
    });
  }, [mapRef, guide, following]);

  if (following) return null;
  return (
    <button
      type="button"
      onClick={() => {
        closeUp.current = false;
        setFollowing(true);
      }}
      className="btn btn-primary btn-sm absolute bottom-10 left-1/2 -translate-x-1/2 shadow-md"
    >
      Wróć do mojego położenia
    </button>
  );
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-3 rounded-full border-2 border-white" style={{ background: color, boxShadow: "0 0 0 1px #6b7280" }} />;
}
