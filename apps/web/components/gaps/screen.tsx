"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FooterNotes } from "@/components/site-footer";

export interface GapsScreenProps {
  title: string;
  lead: string;
  /**
   * An area is analysed: the panel with the conclusions takes a bit more than half of the width and the map the rest
   * (on a phone the map a third of the height). Otherwise the map is large, to look around and draw on.
   */
  wide: boolean;
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
export function GapsScreen({ title, lead, wide, view, map, children }: GapsScreenProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [view]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row print:block">
      <div
        ref={panel}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto md:border-r md:border-line print:w-auto print:overflow-visible print:border-0 ${wide ? "md:min-w-0" : "md:w-80 md:flex-none lg:w-108"}`}
      >
        <div className="@container flex-1 space-y-6 px-4 py-5 lg:px-6">
          <div className="space-y-1 print:hidden">
            <h1 className="text-2xl leading-tight font-bold tracking-tight text-balance">{title}</h1>
            {!wide && <p className="text-sm text-muted">{lead}</p>}
          </div>
          {children}
        </div>
        <footer className="space-y-2 border-t border-line bg-surface px-4 py-4 text-xs text-muted lg:px-6 print:hidden">
          <FooterNotes />
        </footer>
      </div>
      <section
        aria-label="Mapa"
        className={`relative order-first shrink-0 border-b border-line md:order-none md:border-b-0 print:hidden ${wide ? "min-h-48 basis-1/3 md:w-2/5 md:min-w-72 md:flex-none md:basis-auto xl:w-[45%]" : "basis-1/2 md:flex-1 md:basis-auto"}`}
      >
        {map}
      </section>
    </div>
  );
}
