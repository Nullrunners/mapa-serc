import { UNNAMED_PLACE } from "@aed/schema";
import type { AedItem, AedRecord } from "@/lib/api/client";

/** Words shown to people for the values of an AED record. Shared by the list and the device panel. */

export const ACCESS_LABEL: Record<string, string> = { publiczny: "dostęp publiczny", ograniczony: "dostęp ograniczony", prywatny: "tylko dla personelu" };

/** The answer to "can I get to it right now?", in words, so that it does not depend on colour. */
export const AVAILABLE_NOW = {
  yes: { label: "Dostępny teraz", tone: "text-ok" },
  no: { label: "Teraz niedostępny", tone: "text-danger" },
  unknown: { label: "Nie wiadomo, czy teraz dostępny: dane nie podają godzin", tone: "text-muted" },
} as const;

/** Only the states worth a warning; "czynny" and "nieznany" say nothing a passer-by can act on. */
export const STATUS_WARNING: Partial<Record<AedRecord["status"], string>> = {
  czasowo_niedostepny: "Urządzenie jest czasowo niedostępne.",
  wycofany: "Urządzenie zostało wycofane.",
};

export const distance = (metres: number) => (metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1).replace(".", ",")} km`);

export const hours = (value: string) => (value === "24/7" ? "całą dobę" : value);

/** "ul. Lwowska 28a, 38-400 Krosno". In a village without street names the number follows the village: "34-222 Zawoja 2999". */
export const address = (item: AedItem) => {
  const { record } = item;
  // "Rynek 1" has "rynek" for both the kind and the name of the street; say it once.
  const kind = record.cecha_ulicy?.toLowerCase() === record.nazwa_ulicy?.toLowerCase() ? null : record.cecha_ulicy;
  const street = [kind === "ulica" ? "ul." : kind, record.nazwa_ulicy].filter(Boolean).join(" ");
  const town = [record.kod_pocztowy, record.miejscowosc].filter(Boolean).join(" ");
  if (!street) return [town, record.nr_budynku].filter(Boolean).join(" ");
  return [[street, record.nr_budynku].filter(Boolean).join(" "), town].filter(Boolean).join(", ");
};

/**
 * What to call a device. A place nobody named (most of OpenStreetMap) goes by its address, which says where to run;
 * the words about the spot itself ("przy wejściu") are shown as a description, never as the title.
 */
export const title = (item: AedItem) => {
  const { record } = item;
  return record.nazwa === UNNAMED_PLACE && (record.nazwa_ulicy || record.nr_budynku) ? address(item) : record.nazwa;
};

/** The address as a line of its own; null when there is none or when the title already is the address. */
export const addressLine = (item: AedItem) => {
  const text = address(item);
  return text && text !== title(item) ? text : null;
};

/** "2026-03-14" → "14.03.2026". Anything else is shown as it came. */
export const date = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
};
