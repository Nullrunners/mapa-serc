"use client";

import { useEffect, useState } from "react";

export type Loaded<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

/**
 * Runs `load` in the browser whenever `key` changes and reports loading, error or data.
 * `load` must return the data or throw; a request that is no longer wanted is aborted.
 */
export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Loaded<T> {
  const [result, setResult] = useState<{ key: string; value: Loaded<T> }>({ key, value: { state: "loading" } });

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => setResult({ key, value: { state: "ready", data } }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key, value: { state: "error", message: error instanceof Error ? error.message : "Nie udało się pobrać danych." } });
      },
    );
    return () => controller.abort();
    // `load` is a new function on every render; `key` is what identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result.key === key ? result.value : { state: "loading" };
}
