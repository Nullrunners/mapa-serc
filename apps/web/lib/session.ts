import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

/**
 * The keeper's login "with mObywatel". The session is kept in this browser only, travels to the API in a header,
 * and ends by itself after 12 hours. Read it in event handlers and effects, never while rendering.
 */

export type KeeperAccount = components["schemas"]["KeeperAccount"];
export type LoginOptions = components["schemas"]["LoginOptions"];

const KEY = "aed-opiekun-sesja";

/** A browser may refuse storage (private mode, blocked site data); the person is then simply not logged in. */
export function readSession(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveSession(session: string) {
  try {
    window.localStorage.setItem(KEY, session);
  } catch {}
}

export function clearSession() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}

/** The header that tells the API who is logged in; empty when nobody is. */
export const sessionHeader = (): { "x-keeper-session"?: string } => {
  const session = readSession();
  return session ? { "x-keeper-session": session } : {};
};

/** Where „Zaloguj się przez mObywatel” leads. After logging in the person comes back to `returnTo`. */
export const loginHref = (returnTo: string) => `/logowanie?powrot=${encodeURIComponent(returnTo)}`;

/** Only a page of this site may be the place to come back to. */
export const safeReturn = (value: string | null) => (value && /^\/(?![/\\])/.test(value) ? value : "/opiekun");

/** The logged-in keeper with their devices; null when nobody is logged in. A session that has ended is forgotten. */
export async function loadAccount(signal?: AbortSignal): Promise<KeeperAccount | null> {
  const session = readSession();
  if (!session) return null;
  const { data, response } = await api.GET("/v1/account", { params: { header: { "x-keeper-session": session } }, signal });
  if (response.status === 401) clearSession();
  return data ?? null;
}

/** Whether this service lets keepers log in, and how. A service we cannot ask is treated as one without login. */
export async function loadLoginOptions(signal?: AbortSignal): Promise<LoginOptions> {
  const { data } = await api.GET("/v1/auth/login", { signal }).catch(() => ({ data: undefined }));
  return data ?? { mode: "off", people: [] };
}
