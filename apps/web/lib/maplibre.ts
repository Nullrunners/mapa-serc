/**
 * Shared MapLibre setup. Import this module before creating a map, from every component that draws one,
 * so the map works whichever page a person opens first.
 */
import { setWorkerUrl, type Map as MapLibreMap } from "maplibre-gl";

// maplibre-gl 6 looks for its worker next to its own module (import.meta.url). Once Turbopack bundles it
// into a chunk that file is not there, so the workers fail to load. Point it at the worker explicitly;
// `new URL(..., import.meta.url)` makes Turbopack emit the file as a static asset.
setWorkerUrl(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const POLAND: [number, number, number, number] = [14.1, 49.0, 24.2, 54.9];

/**
 * The OpenFreeMap "liberty" style names a few icons its sprite does not have (recycling, gate, brownfield,
 * bollard, ...), and MapLibre warns in the console for each one. They are minor base-map details, so stand in
 * a transparent pixel for any icon the style asks for and does not ship.
 */
export function ignoreMissingStyleIcons(map: MapLibreMap): void {
  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}

/** MapLibre needs WebGL2. Without it the constructor throws, and an uncaught error would take the page down too. */
export function canDrawMap(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}
