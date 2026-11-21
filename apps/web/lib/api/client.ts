/**
 * Typed client of the AED Hub API. The types in ./schema.d.ts are generated from the API's OpenAPI document:
 * after the contract changes run `pnpm contract` (API) and `pnpm --filter @aed/web api:types`.
 */
import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

export const api = createClient<paths>({ baseUrl: API_URL });

export type AedItem = components["schemas"]["AedItem"];
export type AedRecord = components["schemas"]["AedRecord"];
export type SourceReport = components["schemas"]["SourceReport"];
export type KnownSource = components["schemas"]["KnownSource"];
export type StatsResponse = components["schemas"]["StatsResponse"];
export type Candidate = components["schemas"]["Candidate"];
export type Publication = components["schemas"]["Publication"];
export type GapsSummary = components["schemas"]["GapsSummary"];
export type GapsView = components["schemas"]["GapsView"];
export type GapsPlace = components["schemas"]["GapsPlace"];
export type GapsMethod = components["schemas"]["GapsMethod"];
export type GapsTotals = components["schemas"]["GapsTotals"];
export type GapsNearbyDevice = components["schemas"]["GapsNearbyDevice"];
export type GapsHexes = components["schemas"]["GapsHexes"];
export type GapsNear = components["schemas"]["GapsNear"];
export type GapsCommune = components["schemas"]["GapsCommune"];
export type GapsLocality = components["schemas"]["GapsLocalities"]["items"][number];

/**
 * What to tell the person when the API refused: the problem's own sentence and what to fix ("Adres e-mail wygląda
 * na niepełny. Wpisz adres w postaci nazwa@domena.pl."), or `fallback` when there is nothing to say (network error).
 */
export function problemMessage(error: unknown, fallback: string): string {
  const problem = error as { detail?: string | null; issues?: { message: string }[] } | undefined;
  return [problem?.detail, ...(problem?.issues ?? []).map((issue) => issue.message)].filter(Boolean).join(" ") || fallback;
}
