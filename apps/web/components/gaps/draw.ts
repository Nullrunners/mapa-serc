/**
 * Marking an area on the MapLibre map with a rectangle, a lasso or a click in a commune. Plain pointer events on the
 * map's canvas container, so it works the same with a mouse, a pen and a finger, and needs no drawing library.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Bbox, Ring } from "@/lib/gaps-area";
import type { Tool } from "./shared";

export type DrawTool = Exclude<Tool, "move">;

export type Drawn = { tool: "rect"; bbox: Bbox } | { tool: "lasso"; path: Ring } | { tool: "commune"; at: [number, number] };

export interface DrawHandlers {
  /** The outline while it is being drawn, or null when there is none. */
  onDraft: (ring: Ring | null) => void;
  onDone: (drawn: Drawn) => void;
  /** Esc with nothing drawn: put the tool away. */
  onCancel: () => void;
}

/** A gesture smaller than this, in pixels, is a slip, not a shape. */
const MIN_SIZE = 12;
/** Lasso points closer than this, in pixels, add nothing. */
const STEP = 4;
/** A click in a commune may move this many pixels; more is a pan. */
const CLICK_SLOP = 5;

const closed = (ring: Ring): Ring => [...ring, ring[0]!];

/**
 * Arms one tool and returns the function that disarms it. While the rectangle or the lasso is armed a drag draws
 * instead of moving the map (the wheel and a pinch still zoom) and no click reaches the map, so a place under the
 * pointer does not open. The commune tool leaves the map movable and takes a plain click.
 */
export function startDraw(map: MapLibreMap, tool: DrawTool, handlers: DrawHandlers): () => void {
  const container = map.getCanvasContainer();
  const style = { cursor: container.style.cursor, touchAction: container.style.touchAction };
  const undo: (() => void)[] = [() => Object.assign(container.style, style)];
  const listen = <K extends keyof WindowEventMap>(target: HTMLElement | Window, type: K, listener: (event: WindowEventMap[K]) => void, capture = false) => {
    target.addEventListener(type, listener as EventListener, capture);
    undo.push(() => target.removeEventListener(type, listener as EventListener, capture));
  };
  const at = (event: MouseEvent): [number, number] => {
    const box = container.getBoundingClientRect();
    const point = map.unproject([event.clientX - box.left, event.clientY - box.top]);
    return [point.lng, point.lat];
  };

  container.style.cursor = "crosshair";
  let pointer: number | null = null;
  let pixels: [number, number][] = [];
  let path: Ring = [];
  let down: [number, number] | null = null;

  const reset = () => {
    pointer = null;
    pixels = [];
    path = [];
    handlers.onDraft(null);
  };

  const draft = (): Ring => {
    if (tool === "lasso") return closed(path);
    const [[west, north], [east, south]] = [path[0]!, path.at(-1)!];
    return closed([
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ]);
  };

  const finish = () => {
    const xs = pixels.map(([x]) => x);
    const ys = pixels.map(([, y]) => y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const shape = path;
    reset();
    if (size < MIN_SIZE) return;
    if (tool === "rect") {
      const [[a, b], [c, d]] = [shape[0]!, shape.at(-1)!];
      handlers.onDone({ tool: "rect", bbox: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)] });
    } else if (shape.length >= 3) handlers.onDone({ tool: "lasso", path: shape });
  };

  // Clicks belong to the tool. Capture phase on the container: MapLibre listens there in the bubble phase.
  listen(
    container,
    "click",
    (event) => {
      event.stopPropagation();
      if (tool !== "commune" || !down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > CLICK_SLOP) return;
      handlers.onDone({ tool: "commune", at: at(event) });
    },
    true,
  );
  listen(container, "pointerdown", (event) => {
    down = [event.clientX, event.clientY];
    if (tool === "commune") return;
    // A second finger is a pinch, not a shape.
    if (pointer !== null) return reset();
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    container.setPointerCapture(event.pointerId);
    pixels = [[event.clientX, event.clientY]];
    path = [at(event)];
  });
  listen(container, "pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    const last = pixels.at(-1)!;
    if (tool === "lasso" && Math.hypot(event.clientX - last[0], event.clientY - last[1]) < STEP) return;
    const point = at(event);
    if (tool === "rect") {
      pixels = [pixels[0]!, [event.clientX, event.clientY]];
      path = [path[0]!, point];
    } else {
      pixels.push([event.clientX, event.clientY]);
      path.push(point);
    }
    handlers.onDraft(draft());
  });
  listen(container, "pointerup", (event) => {
    if (event.pointerId === pointer) finish();
  });
  listen(container, "pointercancel", reset);
  listen(window, "keydown", (event) => {
    if (event.key !== "Escape") return;
    if (pointer !== null) reset();
    else handlers.onCancel();
  });

  if (tool !== "commune") {
    map.dragPan.disable();
    map.boxZoom.disable();
    map.doubleClickZoom.disable();
    // MapLibre's own stylesheet sets touch-action from its handlers; without this a finger would scroll the page.
    container.style.touchAction = "none";
    undo.push(() => {
      map.dragPan.enable();
      map.boxZoom.enable();
      map.doubleClickZoom.enable();
    });
  }

  return () => {
    for (const step of undo.reverse()) step();
    handlers.onDraft(null);
  };
}
