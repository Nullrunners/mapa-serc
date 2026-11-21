import type { components } from "@/lib/api/schema";
import { capitalize, date, type Tone } from "@/lib/format";

export type PassportPublic = components["schemas"]["PassportPublic"];
export type ReportKind = components["schemas"]["ReportKind"];
export type OwnerView = components["schemas"]["OwnerView"];

/** What a passer-by reports, as the button says it. */
export const REPORT_BUTTON: Record<ReportKind, string> = {
  ok: "Jest na miejscu, zielona dioda miga",
  locked: "Szafka jest zamknięta",
  missing: "Nie ma urządzenia",
  battery_alarm: "Piszczy albo pokazuje alarm baterii",
  damaged: "Urządzenie albo szafka jest uszkodzona",
};

/** The same, as a finished sentence about what someone reported. */
export const REPORT_TEXT: Record<ReportKind, string> = {
  ok: "urządzenie jest na miejscu",
  locked: "szafka zamknięta",
  missing: "brak urządzenia",
  battery_alarm: "alarm baterii",
  damaged: "uszkodzenie",
};

export const PROBLEMS: ReportKind[] = ["locked", "missing", "battery_alarm", "damaged"];

/**
 * How we know who confirmed the device: the keeper was logged in then. The stand-in login of this prototype is
 * named for what it is. Nothing when the keeper came in by the link alone.
 */
export const confirmedHow = (passport: PassportPublic) =>
  passport.confirmedIdentity === "login.gov.pl" ? " (po zalogowaniu przez mObywatel)" : passport.confirmedIdentity === "demo" ? " (po zalogowaniu pokazowym przez mObywatel)" : "";

/** 2–4, 22–24, 32–34…: the numbers Polish follows with "osoby" rather than "osób". */
const few = (count: number) => count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20);

/** " (zgłosiły 3 osoby)", " (zgłosiło 5 osób)" after a reported problem; nothing when one person reported it. */
export const reportedBy = (count: number) => (count > 1 ? ` (${few(count) ? "zgłosiły" : "zgłosiło"} ${count} ${few(count) ? "osoby" : "osób"})` : "");

type ExpiryItem = PassportPublic["items"][number];

/** "Elektrody", "Bateria": the name of a part that wears out, at the start of a line. */
export const partName = (item: ExpiryItem) => capitalize(item.label);

/** "ważne do 30.06.2027", "kończy się 15.12.2026 (za 24 dni)", "termin minął 01.11.2026". */
export function expiryText(item: ExpiryItem): { text: string; tone: Tone } {
  if (!item.date) return { text: "brak danych", tone: "muted" };
  if (item.state === "expired") return { text: `termin minął ${date(item.date)}`, tone: "danger" };
  if (item.state === "soon") return { text: `kończy się ${date(item.date)} (za ${item.daysLeft} ${item.daysLeft === 1 ? "dzień" : "dni"})`, tone: "warn" };
  return { text: `ważne do ${date(item.date)}`, tone: "ok" };
}

/** Short code printed under the QR, for people who type the address by hand. */
export const shortCode = (id: string) => id.slice(0, 8).toUpperCase();

/** Address of a device passport on the site the page was opened from (browser only). */
export const passportHref = (id: string) => `${window.location.origin}/aed/${id}`;

/** Stickers on one A4 sheet page, and devices on one sheet link (the ids travel in the address). */
export const STICKERS_PER_PAGE = 4;
export const STICKERS_PER_SHEET = 40;

/** Links to A4 sheets with the stickers of the given devices, 40 devices per link. */
export function stickerSheets(ids: readonly string[]): { href: string; from: number; to: number }[] {
  const sheets: { href: string; from: number; to: number }[] = [];
  for (let start = 0; start < ids.length; start += STICKERS_PER_SHEET) {
    const part = ids.slice(start, start + STICKERS_PER_SHEET);
    sheets.push({ href: `/naklejki?id=${part.join(",")}`, from: start + 1, to: start + part.length });
  }
  return sheets;
}
