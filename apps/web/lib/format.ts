/** Numbers, distances, times and dates written the way people in Poland write them. Shared by every page. */

/** How a piece of text should look: good news, a warning, a problem, a side note, or plain text. */
export type Tone = "ok" | "warn" | "danger" | "muted" | "plain";

/** "18 782". */
export const count = (value: number) => value.toLocaleString("pl-PL");

/** "350 m", "1,2 km". */
export const distance = (metres: number) => (metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1).replace(".", ",")} km`);

/** "ok. 6 min", "mniej niż minuta". */
export const minutes = (seconds: number) => (seconds < 60 ? "mniej niż minuta" : `ok. ${Math.round(seconds / 60)} min`);

/** "2026-03-14" → "14.03.2026". Anything else is shown as it came. */
export const date = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
};

/** "2026-11-21T14:03:00Z" → "21.11.2026, 15:03" in Polish time. */
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

/** "elektrody" → "Elektrody". */
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
