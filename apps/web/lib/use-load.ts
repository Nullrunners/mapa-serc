"use client";

import { useEffect, useState } from "react";

export type Loaded<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const LOADING = { state: "loading" } as const;

/** The last answer that came, with the key it was asked under. */
function useAnswer<T>(key: string, load: (signal: AbortSignal) => Promise<T>): { key: string; value: Loaded<T> } {
  const [result, setResult] = useState<{ key: string; value: Loaded<T> }>({ key, value: LOADING });

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

  return result;
}

/**
 * Runs `load` in the browser whenever `key` changes and reports loading, error or data.
 * `load` must return the data or throw; a request that is no longer wanted is aborted.
 */
export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Loaded<T> {
  const answer = useAnswer(key, load);
  return answer.key === key ? answer.value : LOADING;
}

/**
 * Like `useLoad`, but the last data stay while the next are on their way, with `refreshing` set: a list that is
 * only being filtered or sorted again does not vanish for a moment and push the page around. The data may then
 * answer the previous question, so `load` should return what they were asked for wherever that matters.
 */
export function useLoadKeeping<T>(key: string, load: (signal: AbortSignal) => Promise<T>): { loaded: Loaded<T>; refreshing: boolean } {
  const answer = useAnswer(key, load);
  if (answer.key === key) return { loaded: answer.value, refreshing: false };
  return answer.value.state === "ready" ? { loaded: answer.value, refreshing: true } : { loaded: LOADING, refreshing: false };
}
