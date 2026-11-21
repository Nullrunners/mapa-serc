/**
 * A walking route from the person to a device, from the public OSRM foot router run by FOSSGIS on OpenStreetMap data.
 * Only the two points are sent, and only after the person shared their position themselves.
 */

export interface Point {
  lat: number;
  lon: number;
}

export interface WalkingRoute {
  /** [lon, lat] pairs, ready for GeoJSON. */
  line: [number, number][];
  distanceM: number;
  durationS: number;
}

const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";

/** Beyond this nobody walks to a defibrillator; the route would only be noise on the map (and a heavy request). */
export const MAX_WALK_M = 10_000;

/** Straight-line distance in metres. */
export function straightDistance(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export async function walkingRoute(from: Point, to: Point, signal: AbortSignal): Promise<WalkingRoute> {
  const url = `${ROUTER}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Nie udało się wyznaczyć trasy.");
  const body = (await response.json()) as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
  const route = body.code === "Ok" ? body.routes?.[0] : undefined;
  if (!route) throw new Error("Nie udało się wyznaczyć trasy.");
  // The router snaps both ends to the nearest path; draw the last few metres to the real points too.
  const line: [number, number][] = [[from.lon, from.lat], ...route.geometry.coordinates, [to.lon, to.lat]];
  return { line, distanceM: Math.round(route.distance), durationS: route.duration };
}

/** "ok. 6 min". */
export const walkTime = (seconds: number) => (seconds < 60 ? "mniej niż minuta" : `ok. ${Math.round(seconds / 60)} min`);

/** Google Maps with the walking directions from the person's position. */
export const googleDirections = (from: Point | null, to: Point) =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lon}` : ""}&destination=${to.lat},${to.lon}&travelmode=walking`;
