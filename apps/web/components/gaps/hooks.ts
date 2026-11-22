"use client";

import { useEffect, useState } from "react";
import { api, problemMessage, type GapsSummary, type GapsView } from "@/lib/api/client";
import { areaKey, type Area, type Bbox } from "@/lib/gaps-area";
import { useLoad, type Loaded } from "@/lib/use-load";
import { levelAt, LEVELS, PLACES, toneOf, type Level, type MapView } from "./shared";

/**
 * The national figures. Right after the server starts they take a few seconds: ask again until they are there,
 * keeping what is shown meanwhile, so the panel does not blink.
 */
export function useSummary(): Loaded<GapsSummary> {
  const [loaded, setLoaded] = useState<Loaded<GapsSummary>>({ state: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const { data, error } = await api.GET("/v1/gaps/summary", { signal: controller.signal });
        if (error || !data) throw new Error("no summary");
        setLoaded({ state: "ready", data });
        if (!data.ready) timer = setTimeout(ask, 4000);
      } catch {
        if (!controller.signal.aborted) setLoaded({ state: "error", message: "Nie udało się pobrać liczb dla Polski. Spróbuj ponownie za chwilę." });
      }
    };
    void ask();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return loaded;
}

/** The analysis of the chosen area. A new area starts from nothing: old figures must not stand beside a new outline. */
export function useAnalysis(area: Area | null, attempt: number): Loaded<GapsView | null> {
  return useLoad(`${area ? areaKey(area) : ""}|${attempt}`, async (signal) => {
    if (!area) return null;
    const { data, error } = await api.GET("/v1/gaps", { params: { query: { ...area.params, n: PLACES, hexes: "0" } }, signal });
    if (error || !data) throw new Error(problemMessage(error, "Nie udało się policzyć braków dla tego obszaru. Spróbuj ponownie za chwilę."));
    return data;
  });
}

/** A hexagon as the map takes it: its outline and its colour (toneOf). */
interface Hex {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: { hex: string; tone: number };
}

/** What the map shows: the hexagons of one level, from the boxes of the view that have come so far. */
export interface Grid {
  level: Level;
  hexes: { type: "FeatureCollection"; features: Hex[] };
}

/** The boxes of a level that cover the view, as "res/x/y". */
export function tilesOf(level: Level, [west, south, east, north]: Bbox): string[] {
  const [width, height] = [level.tile, level.tile / 2];
  const keys: string[] = [];
  for (let x = Math.floor(west / width); x * width < east; x++) {
    for (let y = Math.floor(south / height); y * height < north; y++) keys.push(`${level.res}/${x}/${y}`);
  }
  return keys;
}

/** Boxes fetched, the last asked for at the end; kept for the whole visit, up to about this many hexagons. */
const tiles = new Map<string, Hex[]>();
const MAX_KEPT = 60_000;
let kept = 0;
/** Boxes on their way: a later view that still needs one waits for the same request. */
const loading = new Map<string, { controller: AbortController; done: Promise<void> }>();

function keep(key: string, hexes: Hex[], needed: readonly string[]) {
  tiles.set(key, hexes);
  kept += hexes.length;
  for (const [old, oldHexes] of tiles) {
    if (kept <= MAX_KEPT) break;
    if (needed.includes(old)) continue;
    tiles.delete(old);
    kept -= oldHexes.length;
  }
}

/**
 * Fetches one box; a box that failed stays out of the cache, to be asked for again on the next move. The API sends
 * only the H3 indexes and figures, ten times less than GeoJSON; the outlines are worked out here, by the H3 library,
 * fetched once together with the first box and only by the map.
 */
function fetchTile(key: string, needed: readonly string[]): Promise<void> {
  const [res, x, y] = key.split("/").map(Number) as [number, number, number];
  const level = LEVELS.find((candidate) => candidate.res === res)!;
  const [width, height] = [level.tile, level.tile / 2];
  const controller = new AbortController();
  const bbox = [x * width, y * height, (x + 1) * width, (y + 1) * height].join(",");
  const done = Promise.all([api.GET("/v1/gaps/grid.json", { params: { query: { res, bbox } }, signal: controller.signal }), import("h3-js")])
    .then(([{ data }, { cellToBoundary }]) => {
      if (!data) return;
      const hexes = data.hexes.map(
        (hex, i): Hex => ({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [cellToBoundary(hex, true)] },
          // The colour is worked out here, once: the map then never paints the hexagons of one level by the scale of another.
          properties: { hex, tone: toneOf(data.uncovered[i]!, level.steps) },
        }),
      );
      keep(key, hexes, needed);
    })
    .catch(() => undefined)
    .finally(() => {
      if (loading.get(key)?.controller === controller) loading.delete(key);
    });
  loading.set(key, { controller, done });
  return done;
}

/** The hexagons of the boxes, each once: one on the edge of two boxes may come with both. */
function merge(keys: readonly string[]): Hex[] {
  const seen = new Set<string>();
  const merged: Hex[] = [];
  for (const key of keys) {
    for (const hex of tiles.get(key) ?? []) {
      if (seen.has(hex.properties.hex)) continue;
      seen.add(hex.properties.hex);
      merged.push(hex);
    }
  }
  return merged;
}

/** How long the map must stand still before boxes are fetched: a turn of the mouse wheel ends in several views. */
const SETTLE_MS = 150;

/**
 * The hexagons for the map: the larger the further out it is (see LEVELS), fetched in boxes of a fixed grid, so the
 * same box is never fetched twice, and the server and the browser can keep it. A box that went out of view while on
 * its way is called off. While a new level is coming, the old one stays until the whole view of the new one is
 * there: the map is never empty, and two sizes never lie over each other.
 */
export function useGrid(view: MapView | null): Grid | null {
  const [shown, setShown] = useState<Grid | null>(null);
  const level = view ? levelAt(view.zoom) : null;
  const wanted = level && view ? tilesOf(level, view.bbox).join(" ") : "";

  useEffect(() => {
    if (!level || !wanted) return;
    const needed = wanted.split(" ");
    // Called off and forgotten at once: should the box be needed again, it is fetched anew, not awaited in vain.
    for (const [key, { controller }] of loading) {
      if (needed.includes(key)) continue;
      controller.abort();
      loading.delete(key);
    }
    // In view again: to the end of the line, the last to be dropped.
    for (const key of needed) {
      const hexes = tiles.get(key);
      if (!hexes) continue;
      tiles.delete(key);
      tiles.set(key, hexes);
    }

    let live = true;
    let frame = 0;
    const settled = new Set(needed.filter((key) => tiles.has(key)));
    // Several boxes come within a moment of each other: the map takes them all in one go.
    const show = () => {
      if (!live || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const complete = settled.size === needed.length;
        setShown((before) => (before && before.level !== level && !complete ? before : { level, hexes: { type: "FeatureCollection", features: merge(needed) } }));
      });
    };
    const missing = needed.filter((key) => !settled.has(key));
    if (missing.length === 0) {
      show();
      return () => {
        live = false;
        cancelAnimationFrame(frame);
      };
    }
    const timer = setTimeout(() => {
      for (const key of missing) {
        void (loading.get(key)?.done ?? fetchTile(key, needed)).then(() => {
          settled.add(key);
          show();
        });
      }
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [level, wanted]);

  return shown;
}
