import { distance, minutes } from "@/lib/format";
import type { Progress, Step, Turn } from "@/lib/route";

/** The way to a device in words: what to do at each point of it, said to a person who is running. */

const DO: Record<Exclude<Turn, "start">, string> = {
  straight: "Idź prosto",
  "slight-left": "Skręć lekko w lewo",
  left: "Skręć w lewo",
  "sharp-left": "Skręć ostro w lewo",
  "slight-right": "Skręć lekko w prawo",
  right: "Skręć w prawo",
  "sharp-right": "Skręć ostro w prawo",
  back: "Zawróć",
  roundabout: "Przejdź przez rondo",
  arrive: "Jesteś na miejscu",
  "arrive-left": "Jesteś na miejscu",
  "arrive-right": "Jesteś na miejscu",
};

/** Where to look once there. The device is rarely on the path itself, so the side of it is worth saying. */
const GENERIC_LOOK = "Szukaj zielonego znaku AED";
const LOOK: Partial<Record<Turn, string>> = {
  arrive: GENERIC_LOOK,
  "arrive-left": `${GENERIC_LOOK} po lewej stronie`,
  "arrive-right": `${GENERIC_LOOK} po prawej stronie`,
};

const COMPASS = ["północ", "północny wschód", "wschód", "południowy wschód", "południe", "południowy zachód", "zachód", "północny zachód"];

/** Closer than this the thing is to be done now, not "in a moment". */
const NOW_M = 10;

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A distance on foot, rounded the way people say it: "35 m", "240 m", "1,2 km". */
export const about = (metres: number) => distance(metres < 100 ? Math.max(5, Math.round(metres / 5) * 5) : Math.round(metres / 10) * 10);

/** "Skręć w lewo", "Idź na północny wschód". */
export const stepText = (step: Step) => (step.turn === "start" ? `Idź na ${COMPASS[Math.round(step.heading / 45) % 8]}` : DO[step.turn]);

/** The line under it: the street the person turns into, or where to look for the device. */
export const stepNote = (step: Step) => LOOK[step.turn] ?? step.name;

/** What the person being led sees and hears right now. */
export interface GuideWords {
  /** The arrow next to the words; none while there is no way to follow. */
  turn: Turn | null;
  /** "Za 40 m skręć w lewo". */
  title: string;
  /** The street to turn into, or where to look for the device. */
  note: string;
  /** "Potem skręć w prawo". */
  then: string;
  /** "Zostało 310 m, ok. 4 min". */
  left: string;
  /** For a screen reader: said again only when there is something new to do, not with every metre. */
  say: string;
}

/**
 * Words for the place the person is at. Without `progress` there is no way to follow: either it is still being
 * looked for (`searching`) or the router could not find one.
 */
export function guideWords(progress: Progress | null, searching: boolean): GuideWords {
  if (!progress) {
    const title = searching ? "Wyznaczam drogę…" : "Nie udało się wyznaczyć drogi";
    const note = searching ? "" : "Idź w kierunku przerywanej linii na mapie.";
    return { turn: null, title, note, then: "", left: "", say: `${title} ${note}`.trim() };
  }

  const { next, nextM, then, leftM, leftS, arrived } = progress;
  const note = stepNote(next);
  if (arrived) {
    // A bend a few steps before the device may still be "next"; the person is there all the same.
    const look = LOOK[next.turn] ?? GENERIC_LOOK;
    return { turn: "arrive", title: DO.arrive, note: look, then: "", left: "", say: `${DO.arrive}. ${look}.` };
  }

  const what = lower(stepText(next));
  const soon = nextM < NOW_M;
  const last = next.turn in LOOK;
  return {
    turn: next.turn,
    title: last ? `Do defibrylatora ${about(nextM)}` : soon ? stepText(next) : `Za ${about(nextM)} ${what}`,
    note,
    then: then ? `Potem ${lower(stepText(then))}` : "",
    left: `Zostało ${about(leftM)}, ${minutes(leftS)}`,
    say: last ? `Dalej tą drogą do defibrylatora. ${note}.` : `${soon ? "Teraz" : "Następnie"}: ${what}${note ? `, ${note}` : ""}.`,
  };
}
