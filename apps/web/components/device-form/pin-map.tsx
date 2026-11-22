"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { AED_KINDS, AedIcon } from "@/components/aed-icon";
import { MapFrame, MapUnavailable } from "@/components/map-frame";
import { useMapLibre } from "@/lib/maplibre";
import type { Point } from "@/lib/route";

/** Below this zoom the pin covers a whole street; the place is taken only once the map shows single buildings. */
export const PIN_ZOOM = 16;

/** 5 decimals is about a metre; the API's register lookups are kept by that key too. */
const rounded = (lat: number, lon: number): Point => ({ lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });

export interface PinMapProps {
  /** Where to take the map: a found address, the person's position. A new value moves the map there. */
  target: Point | null;
  /** The place under the pin once the map rests close enough, or null while it shows too much to tell. */
  onMove: (point: Point | null) => void;
}

/**
 * A map with a pin fixed in its middle: the person moves the map until the pin stands on the defibrillator. A click
 * brings the map to that spot. This works the same with a finger, a mouse and the arrow keys, and there is no marker
 * to catch. Without WebGL there is no map, and the place comes from the address search alone.
 */
export default function PinMap({ target, onMove }: PinMapProps) {
  const report = useRef(onMove);
  useEffect(() => {
    report.current = onMove;
  });

  const { frame, container, map, drawable } = useMapLibre(
    (created) => {
      const tell = () => {
        const center = created.getCenter();
        report.current(created.getZoom() >= PIN_ZOOM ? rounded(center.lat, center.lng) : null);
      };
      created.on("moveend", tell);
      created.on("click", (event) => {
        const zoom = created.getZoom();
        created.easeTo({ center: event.lngLat, zoom: zoom >= PIN_ZOOM ? zoom : Math.min(zoom + 4, 18) });
      });
      tell();
    },
    { options: { maxZoom: 19, doubleClickZoom: false } },
  );

  // The first place is jumped to; later ones are flown to, so the person sees where the map went.
  const arrived = useRef(false);
  useEffect(() => {
    if (!target) return;
    if (!drawable) {
      report.current(target);
      return;
    }
    const created = map.current;
    if (!created) return;
    const camera = { center: [target.lon, target.lat] as [number, number], zoom: Math.max(created.getZoom(), 18) };
    if (arrived.current) created.flyTo(camera);
    else created.jumpTo(camera);
    arrived.current = true;
  }, [target, drawable, map]);

  if (!drawable) return <MapUnavailable>Ta przeglądarka nie pokaże mapy. Wpisz adres albo użyj swojej lokalizacji.</MapUnavailable>;

  return (
    <MapFrame frameRef={frame} containerRef={container} label="Mapa: przesuń ją tak, żeby pinezka stała na defibrylatorze">
      {/* The pin's tip is the middle of the map: the icon stands on a short stem that ends there. */}
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center drop-shadow">
        <AedIcon kind={AED_KINDS[0]} size={36} />
        <span className="h-3 w-0.5 bg-ink" />
      </div>
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-ink" />
    </MapFrame>
  );
}
