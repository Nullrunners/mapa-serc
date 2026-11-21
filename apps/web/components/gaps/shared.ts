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
/** Residents of a small hexagon (about 0.1 km²) without a device in reach, counting the hours of the week. */
export const HEX_STEPS = [10, 50, 150, 400, 800] as const;
/** The same for a large hexagon (about 36 km²). */
export const AREA_STEPS = [500, 2000, 5000, 15000, 50000] as const;
/** From this zoom the view is small enough to count exactly ("Policz dla widoku mapy"). */
export const DETAIL_ZOOM = 10;
/** From this zoom the map shows small hexagons of what is in view, without asking. */
export const NEAR_ZOOM = 12;

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
