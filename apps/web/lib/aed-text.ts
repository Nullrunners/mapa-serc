import { UNNAMED_PLACE } from "@aed/schema";
import type { AedItem, AedRecord } from "@/lib/api/client";
import type { Tone } from "@/lib/format";

/** Words shown to people for the values of an AED record. Shared by the list, the device panel and the passport. */

export const ACCESS_LABEL: Record<string, string> = { publiczny: "dostęp publiczny", ograniczony: "dostęp ograniczony", prywatny: "tylko dla personelu" };

/** The moment the person asks about: right now, or the coming night from Saturday to Sunday. */
export type When = "now" | "night";

/**
 * The answer to "can I get to it?" at the chosen moment, in words, so that it does not depend on colour.
 * Without opening hours there is no answer, whatever the moment.
 */
export const AVAILABILITY: Record<When, Record<AedItem["availableNow"], { label: string; tone: Tone }>> = {
  now: {
    yes: { label: "Dostępny teraz", tone: "ok" },
    no: { label: "Teraz niedostępny", tone: "danger" },
    unknown: { label: "Godziny nieznane", tone: "muted" },
  },
  night: {
    yes: { label: "Dostępny o tej porze", tone: "ok" },
    no: { label: "Niedostępny o tej porze", tone: "danger" },
    unknown: { label: "Godziny nieznane", tone: "muted" },
  },
};

/** Only the states worth a warning; "czynny" and "nieznany" say nothing a passer-by can act on. */
export const STATUS_WARNING: Partial<Record<AedRecord["status"], string>> = {
  czasowo_niedostepny: "Urządzenie jest czasowo niedostępne.",
  wycofany: "Urządzenie zostało wycofane.",
};

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

/** Where exactly the device hangs: "przy recepcji, w budynku, piętro: 1". */
export const spot = (record: AedRecord) =>
  [
    record.opis_lokalizacji,
    record.wewnatrz_budynku === true ? "w budynku" : record.wewnatrz_budynku === false ? "na zewnątrz budynku" : null,
    record.pietro ? `piętro: ${record.pietro}` : null,
  ]
    .filter(Boolean)
    .join(", ");

/** How to get to it: the kind of access and the keeper's note. */
export const access = (record: AedRecord) => [record.dostep ? ACCESS_LABEL[record.dostep] : null, record.uwagi_dostepu].filter(Boolean).join(". ");
