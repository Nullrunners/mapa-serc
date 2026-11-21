"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FooterNotes } from "@/components/site-footer";

/**
 * What the panel holds. "pick": the ways to choose an area, in a narrow panel next to a large map to look around and
 * draw on. "area": the figures and conclusions of an area, "place": the report of one place. For those two the panel
 * takes a bit more than half of the width, but never more than its text needs (a wider panel would only hold empty
 * space): the map fills the rest. On a phone the map is a third of the height.
 */
export type GapsLayout = "pick" | "area" | "place";

const PANEL: Record<GapsLayout, string> = {
  pick: "md:w-80 md:flex-none lg:w-108",
  // The text's width plus the panel's side padding (lg:px-6).
  area: "md:w-3/5 md:flex-initial md:min-w-0 md:max-w-[calc(72rem+3rem)] xl:w-[55%]",
  place: "md:w-3/5 md:flex-initial md:min-w-0 md:max-w-[calc(48rem+3rem)] xl:w-[55%]",
};

export interface GapsScreenProps {
  title: string;
  lead: string;
  layout: GapsLayout;
  /** Names what the panel shows; when it changes, the panel starts again from its top. */
  view: string;
  map: ReactNode;
  children: ReactNode;
}

/**
 * The page of gaps: the panel and the map side by side (on a phone the map above the panel), each scrolling on its own.
 * Like MapScreen, with a second layout for the results. In the document the panel comes first: everything on the map
 * can also be reached from it with a keyboard.
 */
export function GapsScreen({ title, lead, layout, view, map, children }: GapsScreenProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [view]);
  const picking = layout === "pick";

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row print:block">
      <div
        ref={panel}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto md:border-r md:border-line print:w-auto print:max-w-none print:overflow-visible print:border-0 ${PANEL[layout]}`}
      >
        <div className="@container flex-1 space-y-6 px-4 py-5 lg:px-6">
          <div className="space-y-1 print:hidden">
            <h1 className="text-2xl leading-tight font-bold tracking-tight text-balance">{title}</h1>
            {picking && <p className="text-sm text-muted">{lead}</p>}
          </div>
          {children}
        </div>
        <footer className="space-y-2 border-t border-line bg-surface px-4 py-4 text-xs text-muted lg:px-6 print:hidden">
          <FooterNotes />
        </footer>
      </div>
      <section
        aria-label="Mapa"
        className={`relative order-first shrink-0 border-b border-line md:order-none md:flex-1 md:basis-auto md:border-b-0 print:hidden ${picking ? "basis-1/2" : "min-h-48 basis-1/3 md:min-w-72"}`}
      >
        {map}
      </section>
    </div>
  );
}
