/** What the map of gaps and its panel share. No MapLibre here: the panel must not pull the map's code into its bundle. */
import type { Bbox } from "@/lib/gaps-area";

export type { Bbox };

export interface MapView {
  bbox: Bbox;
  zoom: number;
}

/** Moving the map, or one of the ways to mark an area on it. */
export type Tool = "move" | "rect" | "lasso" | "commune";

/** One hue from light to dark, so the scale reads without telling red from green. */
export const SCALE = ["#fde0dd", "#fbb4b9", "#f768a1", "#c51b8a", "#7a0177"] as const;
/** Below the first step: a few people without a device. Faint, so a quiet village still shows as counted. */
export const FAINT = "#fdf1f3";
/** From this zoom the view is small enough to count exactly ("Policz dla widoku mapy"). */
export const DETAIL_ZOOM = 10;

/**
 * The hexagons get smaller as the map comes closer. A level (H3 resolution) starts at its zoom, its hexagons some
 * 15 px across, and gives way to the next when they are some 40 px: each is seven times smaller than the one before.
 */
export interface Level {
  res: 5 | 6 | 7 | 8 | 9;
  from: number;
  /** Area of one hexagon, for the legend. */
  km2: string;
  /** Residents of one hexagon without a device in reach, counting the hours of the week: where the colours change. */
  steps: readonly [number, number, number, number, number];
  /**
   * Side of the boxes the level is fetched in, in degrees of longitude (half of it in latitude). Powers of two, so a
   * box has a short, exact address. A view takes a few boxes, and a pan fetches only the new ones.
   */
  tile: number;
}

/**
 * The steps of 6 and 9 are those the map had before it had levels. The others are set from the counts of November
 * 2026 so that each colour covers about as many hexagons as on the levels next to it: zooming in, the map does not
 * suddenly turn pale or dark.
 */
export const LEVELS: readonly Level[] = [
  { res: 5, from: 0, km2: "250", steps: [5000, 15000, 40000, 90000, 250000], tile: 16 },
  { res: 6, from: 6.5, km2: "36", steps: [500, 2000, 5000, 15000, 50000], tile: 8 },
  { res: 7, from: 8, km2: "5", steps: [80, 300, 700, 1500, 7000], tile: 2 },
  { res: 8, from: 9.5, km2: "0,7", steps: [15, 60, 120, 250, 900], tile: 0.5 },
  { res: 9, from: 11, km2: "0,1", steps: [10, 50, 150, 400, 800], tile: 0.25 },
];

export const levelAt = (zoom: number): Level => LEVELS.findLast((level) => zoom >= level.from) ?? LEVELS[0]!;

/** The colour of a hexagon: 0 nobody without a device, 1 fewer than the first step, then one for each step reached. */
export function toneOf(uncovered: number, steps: Level["steps"]): number {
  if (uncovered < 0.5) return 0;
  let tone = 1;
  for (const step of steps) if (uncovered >= step) tone++;
  return tone;
}

/** Quick starts: the biggest cities, each small enough for one analysis. */
export const CITIES: { name: string; bbox: Bbox }[] = [
  { name: "Warszawa", bbox: [20.85, 52.1, 21.27, 52.37] },
  { name: "Kraków", bbox: [19.79, 49.97, 20.22, 50.13] },
  { name: "Łódź", bbox: [19.32, 51.68, 19.64, 51.85] },
  { name: "Wrocław", bbox: [16.8, 51.04, 17.18, 51.21] },
  { name: "Poznań", bbox: [16.73, 52.33, 17.07, 52.51] },
  { name: "Gdańsk", bbox: [18.43, 54.27, 18.95, 54.45] },
];

/** How many places to recommend in one area. */
export const PLACES = 10;
