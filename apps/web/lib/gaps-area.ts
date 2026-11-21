/**
 * The area a person chose to analyse, in the three ways the page offers: a box (a city, the view, a rectangle drawn
 * on the map), a shape drawn with the lasso, or a whole commune. Each knows its outline for the map and its query for
 * the API. Coordinates are [lon, lat], as in GeoJSON.
 */
import type { GapsCommune } from "@/lib/api/client";

export type Bbox = [number, number, number, number];
export type Ring = [number, number][];
/** Polygons of rings, the first ring of each its outline (GeoJSON MultiPolygon coordinates). */
export type Outline = Ring[][];

export interface Area {
  kind: "box" | "shape" | "commune";
  /** "Warszawa", "Gmina Legionowo (miasto)", "Zaznaczony obszar". */
  label: string;
  /** For a commune: its county and voivodeship. */
  detail: string | null;
  bbox: Bbox;
  outline: Outline;
  /** Exactly one way to name the area to /v1/gaps and its CSV. */
  params: { bbox: string } | { area: string } | { terc: string };
}

/** Most corners the API takes for a drawn shape. */
const MAX_CORNERS = 100;

/** About a metre: enough for a shape drawn by hand, and the address stays short. */
const round = (value: number) => Math.round(value * 1e5) / 1e5;

export function boxArea(bbox: Bbox, label: string): Area {
  const [west, south, east, north] = bbox.map(round) as Bbox;
  return {
    kind: "box",
    label,
    detail: null,
    bbox: [west, south, east, north],
    outline: [
      [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    ],
    params: { bbox: [west, south, east, north].join(",") },
  };
}

/** A shape drawn with the lasso, simplified to what the API takes; null when too little was drawn. */
export function shapeArea(path: Ring, label = "Zaznaczony obszar"): Area | null {
  const corners = simplifyToFit(path.map(([lon, lat]) => [round(lon), round(lat)]), MAX_CORNERS);
  if (!corners) return null;
  const lons = corners.map(([lon]) => lon);
  const lats = corners.map(([, lat]) => lat);
  return {
    kind: "shape",
    label,
    detail: null,
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    outline: [[[...corners, corners[0]!]]],
    params: { area: corners.map(([lon, lat]) => `${lon},${lat}`).join(";") },
  };
}

export function communeArea(commune: GapsCommune): Area {
  return {
    kind: "commune",
    label: `Gmina ${commune.gmina}`,
    detail: `${commune.powiat}, województwo ${commune.wojewodztwo}`,
    bbox: commune.bbox as Bbox,
    outline: commune.boundary.coordinates as Outline,
    params: { terc: commune.terc },
  };
}

/** One key per area, for requests and for the panel. */
export const areaKey = (area: Area) => new URLSearchParams(area.params).toString();

/** Everything around the area, to be veiled on the map: a large box with the area cut out, and the area's own holes. */
export function outsideOf(outline: Outline) {
  const around: Ring = [
    [5, 40],
    [35, 40],
    [35, 60],
    [5, 60],
    [5, 40],
  ];
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "MultiPolygon" as const, coordinates: [[around, ...outline.map((polygon) => polygon[0]!)], ...outline.flatMap((polygon) => polygon.slice(1).map((hole) => [hole]))] },
  };
}

/** The box a little bigger than `bbox` and snapped outwards to a grid, so a small pan stays inside it. */
export function snapOut([west, south, east, north]: Bbox, step = 0.02, margin = 0.1): Bbox {
  const [dx, dy] = [(east - west) * margin, (north - south) * margin];
  const snap = (value: number, down: boolean) => Number(((down ? Math.floor(value / step) : Math.ceil(value / step)) * step).toFixed(4));
  return [snap(west - dx, true), snap(south - dy, true), snap(east + dx, false), snap(north + dy, false)];
}

export const contains = (outer: Bbox, inner: Bbox) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

function offset(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas–Peucker on an open line. */
function simplify(points: Ring, tolerance: number): Ring {
  if (points.length <= 2) return points;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = offset(points[i]!, points[0]!, points.at(-1)!);
    if (distance > worst) [worst, index] = [distance, i];
  }
  if (worst <= tolerance) return [points[0]!, points.at(-1)!];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/** The path with at most `max` corners, losing as little of its shape as it can; null when fewer than three are left. */
function simplifyToFit(path: Ring, max: number): Ring | null {
  let corners = path;
  for (let tolerance = 0.00001; corners.length > max; tolerance *= 1.5) corners = simplify(path, tolerance);
  return corners.length >= 3 ? corners : null;
}
