"use client";

import type { ReactNode } from "react";
import type { Tool } from "./shared";

const icon = (path: ReactNode) => (
  <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const TOOLS: { tool: Tool; label: string; hint: string; icon: ReactNode }[] = [
  { tool: "move", label: "Przesuwaj", hint: "Przesuwaj i przybliżaj mapę", icon: icon(<path d="M10 2v16M2 10h16M10 2 7.5 4.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5" />) },
  { tool: "rect", label: "Prostokąt", hint: "Przeciągnij po mapie, żeby zaznaczyć prostokąt", icon: icon(<rect x="3" y="4.5" width="14" height="11" rx="1" strokeDasharray="3 2" />) },
  { tool: "lasso", label: "Lasso", hint: "Przeciągnij po mapie dookoła obszaru, żeby go obrysować", icon: icon(<path d="M6 15c-2.5-1-3.5-3.5-2.5-6C5 5 10 3 14 4.5s3.5 6 0 8c-2.5 1.5-6 1.5-8 .5Zm0 0c0 1.5-1 2.5-2 3" />) },
  { tool: "commune", label: "Gmina", hint: "Kliknij na mapie gminę, którą chcesz policzyć", icon: icon(<path d="M3 6.5 7.5 3l5 2.5L17 4v10l-4.5 3-5-2.5L3 16Zm4.5-3.5v11.5m5-9V17" />) },
];

export interface DrawToolbarProps {
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** An area is marked: offer to remove it. */
  hasArea: boolean;
  onClear: () => void;
  /** What happens now ("Szukam granic gminy…"), shown under the buttons. */
  note: string | null;
}

/**
 * The selection tools, at the top left of the map above its legend. On a narrow map only the icons show; each button
 * keeps its name for screen readers and as a tooltip. The map places it inside a container query.
 */
export function DrawToolbar({ tool, onTool, hasArea, onClear, note }: DrawToolbarProps) {
  const active = TOOLS.find((item) => item.tool === tool);
  const hint = note ?? (tool !== "move" && active ? `${active.hint}. Esc albo „Przesuwaj” kończy.` : null);
  return (
    <>
      <div role="toolbar" aria-label="Zaznaczanie obszaru na mapie" className="pointer-events-auto flex flex-wrap overflow-hidden rounded-md border border-field bg-white text-sm font-semibold shadow-sm">
        {TOOLS.map((item) => (
          <button
            key={item.tool}
            type="button"
            aria-pressed={tool === item.tool}
            aria-label={item.label}
            title={item.hint}
            onClick={() => onTool(item.tool)}
            className="flex items-center gap-1.5 border-r border-line px-2.5 py-2 text-gov last:border-r-0 hover:bg-gov-light aria-pressed:bg-gov aria-pressed:text-white"
          >
            {item.icon}
            <span aria-hidden className="hidden @lg:inline">
              {item.label}
            </span>
          </button>
        ))}
        {hasArea && (
          <button type="button" aria-label="Usuń zaznaczenie" title="Usuń zaznaczenie i wróć do mapy Polski" onClick={onClear} className="flex items-center gap-1.5 px-2.5 py-2 text-danger hover:bg-danger/5">
            {icon(<path d="m5 5 10 10M15 5 5 15" />)}
            <span aria-hidden className="hidden @lg:inline">
              Usuń
            </span>
          </button>
        )}
      </div>
      {hint && <p className="pointer-events-auto max-w-sm rounded-md bg-ink/90 px-2.5 py-1.5 text-xs font-semibold text-white">{hint}</p>}
    </>
  );
}
