import type { components } from "@/lib/api/schema";
import { minutes, type Tone } from "@/lib/format";

/** "Najszybciej w ręku" in words: what the order of the list is based on, said to the person who has to run. */

export type Reach = components["schemas"]["Reach"];
type ReasonCode = Reach["reasons"][number];

const STATE: Record<Reach["state"], { label: string; tone: Tone }> = {
  open: { label: "Dostępny", tone: "ok" },
  likely_open: { label: "Prawdopodobnie dostępny", tone: "ok" },
  unknown: { label: "Dostępność nieznana", tone: "muted" },
  closed: { label: "Niedostępny", tone: "danger" },
};

const REASON: Partial<Record<ReasonCode, string>> = {
  hours_24_7: "całą dobę",
  outdoor_no_hours: "na zewnątrz, godziny nieznane",
  no_hours: "godziny nieznane",
  assumed_closed: "budynek zwykle zamknięty o tej porze",
  staff_only: "tylko dla personelu",
  out_of_service: "wyłączony z użytku",
  method_free: "wystarczy sięgnąć",
  method_alarm: "szafka z alarmem, bez klucza",
  method_code: "szafka na kod, poda go 112",
  method_staff: "u obsługi (recepcja, portier)",
  outdoor: "na zewnątrz",
  reported_problem: "zgłoszono problem",
};

const DAY_NAMES = ["dziś", "jutro", "pojutrze"];

/** "czynny do 18:00", "otwierają jutro o 8:00". */
function change(reach: Reach): string | null {
  const next = reach.change;
  if (!next) return null;
  const time = next.time.replace(/^0/, "");
  const day = next.days < DAY_NAMES.length ? DAY_NAMES[next.days] : `za ${next.days} dni`;
  if (next.open) return next.days === 0 ? `czynny do ${time}` : `czynny do ${day}, ${time}`;
  return next.days === 0 ? `otwierają o ${time}` : `otwierają ${day} o ${time}`;
}

export function reachSummary(reach: Reach, pietro: string | null) {
  const state = STATE[reach.state];
  const details = reach.reasons
    .map((code) => (code === "floor" ? (pietro ? `piętro ${pietro}` : null) : (REASON[code] ?? null)))
    .filter((text): text is string => text !== null);
  if (reach.methodGuessed) details.push("dostęp odczytany z opisu");
  return {
    headline: [state.label, change(reach)].filter(Boolean).join(", "),
    tone: state.tone,
    eta: reach.etaS === null ? null : reach.etaS < 60 ? "w ręku w niecałą minutę" : `w ręku za ${minutes(reach.etaS)}`,
    details,
  };
}

/** The coming night from Saturday to Sunday, 3:00 in the browser's time zone (people using this are in Poland). */
export function nextSundayNight(from = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
  date.setHours(3, 0, 0, 0);
  return date.toISOString();
}
