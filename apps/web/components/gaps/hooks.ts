"use client";

import { useEffect, useState } from "react";
import { api, problemMessage, type GapsNear, type GapsSummary, type GapsView } from "@/lib/api/client";
import { areaKey, contains, snapOut, type Area, type Bbox } from "@/lib/gaps-area";
import { useLoad, type Loaded } from "@/lib/use-load";
import { NEAR_ZOOM, PLACES, type MapView } from "./shared";

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
    const { data, error } = await api.GET("/v1/gaps", { params: { query: { ...area.params, n: PLACES } }, signal });
    if (error || !data) throw new Error(problemMessage(error, "Nie udało się policzyć braków dla tego obszaru. Spróbuj ponownie za chwilę."));
    return data;
  });
}

/**
 * Small hexagons of the part of the map in view, once it is close enough. The box asked for is a little bigger than
 * the view and snapped to a grid, so a small pan needs no new request, and the last hexagons stay until new ones come.
 * `covers`: they fill the whole view, so the large hexagons underneath can go.
 */
export function useNearHexes(view: MapView | null, enabled: boolean): { hexes: GapsNear | null; covers: boolean } {
  const [near, setNear] = useState<{ box: Bbox; data: GapsNear } | null>(null);
  const wanted = enabled && view && view.zoom >= NEAR_ZOOM ? view.bbox : null;
  const covers = near !== null && wanted !== null && !near.data.tooLarge && contains(near.box, wanted);
  const box = wanted && !covers ? snapOut(wanted).join(",") : null;

  useEffect(() => {
    if (!box) return;
    const controller = new AbortController();
    // Wait until the map has stopped for a moment: a fling ends in many views.
    const timer = setTimeout(async () => {
      const { data } = await api.GET("/v1/gaps/hexes.geojson", { params: { query: { bbox: box } }, signal: controller.signal }).catch(() => ({ data: undefined }));
      if (data) setNear({ box: box.split(",").map(Number) as Bbox, data });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [box]);

  return { hexes: wanted && near ? near.data : null, covers };
}
