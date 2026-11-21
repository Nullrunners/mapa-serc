"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { FooterNotes } from "@/components/site-footer";

export interface MapScreenProps {
  title: string;
  lead: string;
  /** The panel shows one thing (a device, a report) instead of the list, and the lead gives way to it. */
  focused?: boolean;
  /** Names what the panel shows; when it changes, the panel starts again from its top. */
  view: string;
  /** On a phone the map takes more of the screen than the panel: the person is walking by it. */
  tallMap?: boolean;
  map: ReactNode;
  children: ReactNode;
}

/**
 * A page that is a map. The map fills the screen under the header; the panel with the controls and the list stands
 * beside it (on a phone, under it) and scrolls on its own. In the document the panel comes first: the map is an
 * addition, and everything on it can also be reached from the panel with a keyboard.
 */
export function MapScreen({ title, lead, focused = false, view, tallMap = false, map, children }: MapScreenProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [view]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row print:block">
      <div ref={panel} className="flex min-h-0 flex-1 flex-col overflow-y-auto md:w-80 md:flex-none md:border-r md:border-line lg:w-108 print:w-auto print:overflow-visible print:border-0">
        <div className="flex-1 space-y-6 px-4 py-5 lg:px-6">
          <div className="space-y-1 print:hidden">
            <h1 className="text-2xl leading-tight font-bold tracking-tight text-balance">{title}</h1>
            {!focused && <p className="text-sm text-muted">{lead}</p>}
          </div>
          {children}
        </div>
        <footer className="space-y-2 border-t border-line bg-surface px-4 py-4 text-xs text-muted lg:px-6 print:hidden">
          <FooterNotes />
        </footer>
      </div>
      <section aria-label="Mapa" className={`relative order-first shrink-0 ${tallMap ? "basis-2/3" : "basis-1/2"} border-b border-line md:order-none md:flex-1 md:basis-auto md:border-b-0 print:hidden`}>
        {map}
      </section>
    </div>
  );
}

/** The MapLibre map fills the whole field; the legend is drawn over it, and goes full screen with it. */
export function MapFrame({ frameRef, containerRef, label, children }: { frameRef: Ref<HTMLDivElement>; containerRef: Ref<HTMLDivElement>; label: string; children?: ReactNode }) {
  return (
    <div ref={frameRef} className="absolute inset-0 overflow-hidden bg-surface">
      {/* MapLibre's own CSS sets `.maplibregl-map { position: relative }` outside any cascade layer, so it beats
          Tailwind's layered `absolute` and the map collapses to 0 px. The positioning lives on a wrapper instead. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" role="region" aria-label={label} />
      </div>
      {children}
    </div>
  );
}

/**
 * In the top left corner: the zoom and full-screen buttons take the top right, and on a narrow map MapLibre keeps the
 * credits unfolded along the bottom until the map is first moved.
 */
export function MapLegend({ children }: { children: ReactNode }) {
  return (
    <div role="group" aria-label="Legenda mapy" className="absolute top-2 left-2 mr-12 max-w-xs rounded-md bg-white/95 px-2.5 py-1.5 text-xs shadow-sm">
      {children}
    </div>
  );
}

/** Shown while the map's code loads. */
export function MapPlaceholder() {
  return <div aria-hidden className="absolute inset-0 bg-surface" />;
}

/** Shown instead of the map in a browser without WebGL2. */
export function MapUnavailable({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface p-6 text-center">
      <p className="max-w-sm">{children}</p>
    </div>
  );
}
