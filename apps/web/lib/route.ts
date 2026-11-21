/**
 * A walking route from the person to a device, from the public OSRM foot router run by FOSSGIS on OpenStreetMap data.
 * Only the two points are sent, and only after the person shared their position themselves.
 */

export interface Point {
  lat: number;
  lon: number;
}

/** What to do at one point of the way. `start` and the `arrive` ones are its two ends. */
export type Turn = "start" | "straight" | "slight-left" | "left" | "sharp-left" | "slight-right" | "right" | "sharp-right" | "back" | "roundabout" | "arrive" | "arrive-left" | "arrive-right";

/** A point of the way where the person has to do something, and the stretch that follows it. */
export interface Step {
  turn: Turn;
  /** The street or path walked from this point on; footpaths often have no name. */
  name: string;
  /** Metres from the start of the way to this point. */
  atM: number;
  /** Metres to walk from this point to the next one. */
  lengthM: number;
  /** Compass direction of the walk from this point, in degrees clockwise from north. */
  heading: number;
}

export interface WalkingRoute {
  /** [lon, lat] pairs, ready for GeoJSON. */
  line: [number, number][];
  /** Metres from the start of the line to each of its points. */
  alongM: number[];
  steps: Step[];
  distanceM: number;
  durationS: number;
}

/** Where the person is on the way, and what comes next. */
export interface Progress {
  /** Their place on the way while they walk along it, otherwise where the GPS puts them. */
  at: Point;
  /** How far from the way they are. */
  offM: number;
  /** Which way to go from there, in degrees clockwise from north. */
  bearing: number;
  /** The part of the way still ahead, as [lon, lat] pairs. */
  rest: [number, number][];
  leftM: number;
  leftS: number;
  /** The next point where something has to be done, how far it is, and the point after it. */
  next: Step;
  nextM: number;
  then: Step | null;
  arrived: boolean;
}

const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
const RAD = Math.PI / 180;
const EARTH_M = 6_371_000;

/** Beyond this nobody walks to a defibrillator; the route would only be noise on the map (and a heavy request). */
export const MAX_WALK_M = 10_000;
/** This far from the way the person is no longer walking along it, and a new way is worth asking for. */
export const OFF_WAY_M = 40;
/** The router answers in a fraction of a second; one quiet for longer is stuck, and the person needs a direction now. */
const ROUTER_WAIT_MS = 6_000;

/** GPS wanders by a dozen metres; within this the person is shown on the way, not next to it. */
const ON_WAY_M = 25;
/** With this much left the person is at the device. */
const ARRIVED_M = 20;
/** The map is turned towards a point this far ahead, so a short kink in the path does not swing it. */
const LOOK_AHEAD_M = 25;
/** Two bends this close together are one bend to a person on foot. */
const JOG_M = 5;

/** Straight-line distance in metres. */
export function straightDistance(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/** Compass direction from one point to another, in degrees clockwise from north. */
export function bearing(a: Point, b: Point): number {
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

interface RouterStep {
  name: string;
  geometry: { coordinates: [number, number][] };
  maneuver: { type: string; modifier?: string; bearing_before: number; bearing_after: number };
}

interface RouterRoute {
  distance: number;
  duration: number;
  legs: { steps: RouterStep[] }[];
}

/** Asks the router, giving up after `ROUTER_WAIT_MS` as well as when `signal` aborts. */
async function askRouter(url: string, signal: AbortSignal): Promise<{ code: string; routes?: RouterRoute[] }> {
  // Not `AbortSignal.any`: Safari has it only since 17.4, and older phones must still get a way.
  const giveUp = new AbortController();
  const abort = () => giveUp.abort();
  const timer = setTimeout(abort, ROUTER_WAIT_MS);
  signal.addEventListener("abort", abort);
  try {
    const response = await fetch(url, { signal: giveUp.signal });
    if (!response.ok) throw new Error("Nie udało się wyznaczyć trasy.");
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export async function walkingRoute(from: Point, to: Point, signal: AbortSignal): Promise<WalkingRoute> {
  const body = await askRouter(`${ROUTER}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false&geometries=geojson&steps=true`, signal);
  const route = body.code === "Ok" ? body.routes?.[0] : undefined;
  const steps = route?.legs[0]?.steps;
  if (!route || !steps?.length) throw new Error("Nie udało się wyznaczyć trasy.");

  // The router snaps both ends to the nearest path; draw the last few metres to the real points too.
  const line: [number, number][] = [[from.lon, from.lat]];
  // Each step begins where the one before it ended, so its first point is already on the line.
  const firstPoint = steps.map((step, index) => {
    line.push(...(index === 0 ? step.geometry.coordinates : step.geometry.coordinates.slice(1)));
    return line.length - step.geometry.coordinates.length;
  });
  line.push([to.lon, to.lat]);

  const alongM = [0];
  for (let i = 1; i < line.length; i++) alongM.push(alongM[i - 1] + straightDistance(toPoint(line[i - 1]), toPoint(line[i])));
  const totalM = alongM[alongM.length - 1];

  return { line, alongM, steps: stepsOf(steps, (index) => alongM[firstPoint[index]], totalM), distanceM: Math.round(route.distance), durationS: route.duration };
}

const toPoint = ([lon, lat]: [number, number]): Point => ({ lat, lon });

const BENDS: Record<string, Turn> = {
  uturn: "back",
  "sharp right": "sharp-right",
  right: "right",
  "slight right": "slight-right",
  straight: "straight",
  "slight left": "slight-left",
  left: "left",
  "sharp left": "sharp-left",
};
const isBend = (turn: Turn) => Object.values(BENDS).includes(turn);

/** What the router's manoeuvre asks of a person on foot, or null when it asks nothing (the street only changes its name). */
function turnOf({ type, modifier = "" }: RouterStep["maneuver"]): Turn | null {
  if (type === "depart") return "start";
  if (type === "arrive") return modifier.includes("left") ? "arrive-left" : modifier.includes("right") ? "arrive-right" : "arrive";
  if (type === "new name" || type === "notification" || type === "exit roundabout" || type === "exit rotary") return null;
  if (type === "roundabout" || type === "rotary") return "roundabout";
  return BENDS[modifier] ?? "straight";
}

/** A bend named from how far the walk turns: to the right when the angle is positive. */
function bendBy(degrees: number): Turn {
  const angle = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const size = Math.abs(angle);
  if (size < 20) return "straight";
  if (size > 170) return "back";
  const side = angle > 0 ? "right" : "left";
  return size < 50 ? `slight-${side}` : size < 130 ? side : `sharp-${side}`;
}

function stepsOf(raw: RouterStep[], startM: (index: number) => number, totalM: number): Step[] {
  const steps: Step[] = [];
  // The direction walked just before the last step on the list.
  let before = 0;
  raw.forEach(({ name, maneuver }, index) => {
    const turn = turnOf(maneuver);
    if (!turn) return;
    // The way starts where the person stands and ends at the device itself, not where the router put its ends.
    const atM = turn === "start" ? 0 : isBend(turn) || turn === "roundabout" ? startM(index) : totalM;
    const last = steps[steps.length - 1];
    if (last && isBend(last.turn) && isBend(turn) && atM - last.atM < JOG_M) {
      // A step or two between two bends: say once which way the person ends up going.
      last.turn = bendBy(maneuver.bearing_after - before);
      last.name = name;
      last.heading = maneuver.bearing_after;
      return;
    }
    steps.push({ turn, name, atM, lengthM: 0, heading: maneuver.bearing_after });
    before = maneuver.bearing_before;
  });
  steps.forEach((step, index) => (step.lengthM = (steps[index + 1]?.atM ?? totalM) - step.atM));
  return steps;
}

/** The point of the line closest to the person: on which segment, how far along it (0 to 1), and how far away. */
function closest(line: [number, number][], here: Point): { segment: number; part: number; offM: number } {
  // A flat map in metres with the person in the middle: over a walk the curve of the Earth does not show.
  const shrink = Math.cos(here.lat * RAD);
  const flat = ([lon, lat]: [number, number]): [number, number] => [(lon - here.lon) * RAD * EARTH_M * shrink, (lat - here.lat) * RAD * EARTH_M];
  let best = { segment: 0, part: 0, offM: Infinity };
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = flat(line[i]);
    const [bx, by] = flat(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const part = length2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length2));
    const offM = Math.hypot(ax + part * dx, ay + part * dy);
    if (offM < best.offM) best = { segment: i, part, offM };
  }
  return best;
}

/** The point this many metres from the start of the way. */
function pointAt({ line, alongM }: WalkingRoute, metres: number): Point {
  let i = 0;
  while (i + 2 < line.length && alongM[i + 1] < metres) i++;
  const length = alongM[i + 1] - alongM[i];
  const part = length === 0 ? 0 : Math.min(1, Math.max(0, (metres - alongM[i]) / length));
  return { lat: line[i][1] + part * (line[i + 1][1] - line[i][1]), lon: line[i][0] + part * (line[i + 1][0] - line[i][0]) };
}

/** Finds the person on the way: how much of it is left, which way to go and what to do next. */
export function follow(route: WalkingRoute, here: Point): Progress {
  const { line, alongM, steps } = route;
  const totalM = alongM[alongM.length - 1];
  const { segment, part, offM } = closest(line, here);
  const doneM = alongM[segment] + part * (alongM[segment + 1] - alongM[segment]);
  const leftM = totalM - doneM;
  const [a, b] = [line[segment], line[segment + 1]];
  const at = offM <= ON_WAY_M ? { lat: a[1] + part * (b[1] - a[1]), lon: a[0] + part * (b[0] - a[0]) } : here;

  // Off the way the direction leads back to it; at its very end there is nothing ahead, so keep the last direction.
  const ahead = pointAt(route, Math.min(totalM, doneM + LOOK_AHEAD_M));
  const direction = straightDistance(at, ahead) > 1 ? bearing(at, ahead) : bearing(pointAt(route, totalM - LOOK_AHEAD_M), ahead);

  const index = steps.findIndex((step) => step.turn !== "start" && step.atM > doneM);
  const next = steps[index === -1 ? steps.length - 1 : index];
  return {
    at,
    offM,
    bearing: direction,
    rest: [[at.lon, at.lat], ...line.slice(segment + 1)],
    leftM,
    leftS: route.distanceM > 0 ? (leftM * route.durationS) / route.distanceM : 0,
    next,
    nextM: Math.max(0, next.atM - doneM),
    then: index === -1 ? null : (steps[index + 1] ?? null),
    arrived: leftM <= ARRIVED_M && offM <= ON_WAY_M,
  };
}

/** Google Maps with the walking directions to a point, from the person's position when we know it. */
export const googleDirections = (from: Point | null, to: Point) =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lon}` : ""}&destination=${to.lat},${to.lon}&travelmode=walking`;

/** Google Maps centred on a point. */
export const googlePlace = (point: Point) => `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lon}`;
