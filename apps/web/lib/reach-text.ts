import type { components } from "@/lib/api/schema";

/** "Dostępny TERAZ" in words: what the order of the list is based on, said to the person who has to run. */

export type Reach = components["schemas"]["Reach"];
type ReasonCode = Reach["reasons"][number];

const STATE: Record<Reach["state"], { label: string; tone: string }> = {
  open: { label: "Dostępny", tone: "text-ok" },
  likely_open: { label: "Prawdopodobnie dostępny", tone: "text-ok" },
  unknown: { label: "Nie wiadomo, czy dostępny", tone: "text-muted" },
  closed: { label: "Niedostępny", tone: "text-danger" },
};

const REASON: Partial<Record<ReasonCode, string>> = {
  hours_24_7: "dostępny całą dobę",
  outdoor_no_hours: "na zewnątrz budynku, godzin nie podano",
  no_hours: "dane nie podają godzin",
  assumed_closed: "o tej porze budynki są zwykle zamknięte",
  staff_only: "tylko dla personelu",
  out_of_service: "wyłączony z użytku",
  method_free: "wystarczy sięgnąć",
  method_alarm: "szafka z alarmem, otwiera się bez klucza",
  method_code: "szafka na kod: kod poda dyspozytor 112",
  method_staff: "wydaje go obsługa (recepcja, portier, ochrona)",
  outdoor: "na zewnątrz budynku",
  reported_problem: "ktoś niedawno zgłosił problem",
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

/** "ok. 2 min" for the time until the device is in hand. */
function eta(seconds: number): string {
  if (seconds < 60) return "mniej niż minuta";
  return `ok. ${Math.round(seconds / 60)} min`;
}

export function reachSummary(reach: Reach, pietro: string | null) {
  const state = STATE[reach.state];
  const headline = [state.label, change(reach)].filter(Boolean).join(", ");
  const details = reach.reasons
    .map((code) => (code === "floor" ? (pietro ? `piętro ${pietro}` : null) : (REASON[code] ?? null)))
    .filter((text): text is string => text !== null);
  if (reach.methodGuessed) details.push("sposób dostępu odczytany z opisu");
  return {
    headline,
    tone: state.tone,
    eta: reach.etaS === null ? null : `${eta(reach.etaS)} do defibrylatora w ręku`,
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
