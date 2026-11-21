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
export type StatsResponse = components["schemas"]["StatsResponse"];
export type Candidate = components["schemas"]["Candidate"];
export type Publication = components["schemas"]["Publication"];
export type GapsSummary = components["schemas"]["GapsSummary"];
export type GapsView = components["schemas"]["GapsView"];
export type GapsPlace = components["schemas"]["GapsPlace"];
export type GapsMethod = components["schemas"]["GapsMethod"];
export type GapsTotals = components["schemas"]["GapsTotals"];
export type GapsNearbyDevice = components["schemas"]["GapsNearbyDevice"];
