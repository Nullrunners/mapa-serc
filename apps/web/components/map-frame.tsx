import type { ReactNode, Ref } from "react";

/**
 * The panel and the map side by side on a wide screen, the map staying in view while the panel scrolls.
 * On a phone the map sits between the controls and the results, so what the controls change is in sight at once.
 * The map is an addition: everything on it can also be reached from the panel with a keyboard.
 */
export function MapLayout({ controls, map, results }: { controls: ReactNode; map: ReactNode; results?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{controls}</div>
      <section
        aria-label="Mapa"
        className="h-[55vh] max-h-112 min-h-72 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-[calc(100dvh-7.5rem)] lg:max-h-none lg:self-start print:hidden"
      >
        {map}
      </section>
      {results && <div className="min-w-0 lg:col-start-1 lg:row-start-2">{results}</div>}
    </div>
  );
}

/** The box a MapLibre map is drawn in, with room for a legend on top of it. */
export function MapFrame({ containerRef, label, children }: { containerRef: Ref<HTMLDivElement>; label: string; children?: ReactNode }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-line">
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
 * In the top left corner: the zoom buttons take the top right, and on a narrow map MapLibre keeps the credits
 * unfolded along the bottom until the map is first moved.
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
  return <div aria-hidden className="h-full w-full rounded-lg bg-surface" />;
}

/** Shown instead of the map in a browser without WebGL2. */
export function MapUnavailable({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg bg-surface p-6 text-center">
      <p className="max-w-sm">{children}</p>
    </div>
  );
}
