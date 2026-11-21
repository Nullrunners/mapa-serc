import type { FieldDef } from "@aed/schema";

/** Words for the data pattern: how much a field is needed and what kind of value it holds. */

export const REQUIREMENT: Record<FieldDef["requirement"], string> = { required: "wymagane", recommended: "zalecane", optional: "opcjonalne" };

export const VALUE_TYPE: Record<FieldDef["type"], string> = { string: "tekst", number: "liczba", boolean: "true / false", date: "data RRRR-MM-DD" };
