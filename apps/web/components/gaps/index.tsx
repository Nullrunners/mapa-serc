"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { MapPlaceholder } from "@/components/map-frame";
import type { Message } from "@/components/ui";
import { api, API_URL, problemMessage, type GapsLocality } from "@/lib/api/client";
import { areaKey, boxArea, communeArea, shapeArea, type Area } from "@/lib/gaps-area";
import { AreaPicker } from "./area-picker";
import { Dashboard } from "./dashboard";
import type { Drawn } from "./draw";
import { DrawToolbar } from "./draw-toolbar";
import { useAnalysis, useNearHexes, useSummary } from "./hooks";
import { Method } from "./method";
import GapReport from "./report";
import { GapsScreen } from "./screen";
import { DETAIL_ZOOM, PLACES, type MapView, type Tool } from "./shared";

const GapsMap = dynamic(() => import("./map"), { ssr: false, loading: () => <MapPlaceholder /> });

/** Leave full screen once an area is chosen: its figures are in the panel. */
const leaveFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
};

/**
 * The map of gaps in AED cover. Before an area is chosen: the map large, the country's figures and the ways to choose.
 * After: the figures, conclusions and best places for new devices in the wide panel, the area on a smaller map, and
 * from there the report of one place.
 */
export default function Gaps({ title, lead }: { title: string; lead: string }) {
  const [view, setView] = useState<MapView | null>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [area, setArea] = useState<Area | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [lookup, setLookup] = useState<Message | null>(null);
  const [looking, setLooking] = useState(false);
  const areaHeading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  const summary = useSummary();
  const analysis = useAnalysis(area, attempt);
  const near = useNearHexes(view, area === null);

  const result = analysis.state === "ready" ? analysis.data : null;
  const counted = result && !result.tooLarge ? result : null;
  const places = counted?.places ?? [];
  const place = places.find((candidate) => candidate.rank === selected) ?? null;
  const method = counted?.method ?? (summary.state === "ready" ? summary.data.method : null);
  const poland = summary.state === "ready" && summary.data.ready ? summary.data.totals : null;
  const csvHref = area ? `${API_URL}/v1/gaps.csv?${new URLSearchParams({ ...area.params, n: String(PLACES) })}` : "";

  const choose = (next: Area) => {
    setSelected(null);
    setLookup(null);
    setTool("move");
    setArea(next);
    leaveFullscreen();
    requestAnimationFrame(() => areaHeading.current?.focus({ preventScroll: true }));
  };

  const findCommune = async (lon: number, lat: number) => {
    setLooking(true);
    setLookup({ text: "Szukam granic gminy…", tone: "muted" });
    const { data, error } = await api.GET("/v1/gaps/commune", { params: { query: { at: `${lon.toFixed(5)},${lat.toFixed(5)}` } } }).catch(() => ({ data: undefined, error: undefined }));
    setLooking(false);
    if (data) choose(communeArea(data));
    else setLookup({ text: problemMessage(error, "Nie udało się ustalić gminy. Spróbuj jeszcze raz albo zaznacz obszar prostokątem."), tone: "danger" });
  };

  const onDrawn = (drawn: Drawn) => {
    if (drawn.tool === "rect") choose(boxArea(drawn.bbox, "Zaznaczony obszar"));
    else if (drawn.tool === "lasso") {
      const shape = shapeArea(drawn.path);
      if (shape) choose(shape);
    } else if (!looking) void findCommune(...drawn.at);
  };

  const clear = () => {
    setArea(null);
    setSelected(null);
    setLookup(null);
  };
  const closeReport = () => {
    setSelected(null);
    requestAnimationFrame(() => listHeading.current?.focus());
  };
  const onView = useCallback((next: MapView) => setView(next), []);

  const canAnalyseView = view !== null && view.zoom >= DETAIL_ZOOM;
  // Large hexagons stay wherever small ones do not fill the view yet, so the map is never empty.
  const overview = counted ? counted.hexes.features.length === 0 : !near.covers;
  const hexes = area ? (counted?.hexes ?? null) : near.hexes;
  const report = place && method;

  return (
    <GapsScreen
      title={title}
      lead={lead}
      layout={report ? "place" : area ? "area" : "pick"}
      view={report ? `miejsce-${place.rank}` : area ? areaKey(area) : "wybor"}
      map={
        <GapsMap
          overview={overview}
          hexes={hexes}
          area={area}
          places={places}
          selected={selected}
          onSelect={(rank) => tool === "move" && setSelected(rank)}
          onView={onView}
          tool={tool}
          onDrawn={onDrawn}
          onToolCancel={() => setTool("move")}
        >
          <DrawToolbar tool={tool} onTool={setTool} hasArea={area !== null} onClear={clear} note={tool === "commune" && lookup ? lookup.text : null} />
        </GapsMap>
      }
    >
      {report ? (
        <GapReport place={place} method={method} csvHref={csvHref} onClose={closeReport} />
      ) : area ? (
        <Dashboard
          area={area}
          analysis={analysis}
          poland={poland}
          csvHref={csvHref}
          onClear={clear}
          onRetry={() => setAttempt((value) => value + 1)}
          onSelect={setSelected}
          headingRef={areaHeading}
          listRef={listHeading}
        />
      ) : (
        <div className="space-y-8">
          <AreaPicker
            summary={summary}
            onCity={(city) => choose(boxArea(city.bbox, city.name))}
            canAnalyseView={canAnalyseView}
            onAnalyseView={() => view && choose(boxArea(view.bbox, "Widoczny obszar mapy"))}
            onLocality={(locality: GapsLocality) => void findCommune(locality.lon, locality.lat)}
            lookup={lookup}
            busy={looking}
          />
          {method && <Method method={method} />}
        </div>
      )}
    </GapsScreen>
  );
}
