"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Candidate } from "@/lib/api/client";
import { count } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const KINDS = [
  { value: "", label: "Wszystkie" },
  { value: "procurement", label: "Zakupy publiczne" },
  { value: "osm_gap", label: "Mapa społeczności" },
] as const;

const KIND_LABEL: Record<string, string> = { osm_gap: "mapa społeczności", procurement: "zakup publiczny", web: "strona urzędu" };
const STATUS_LABEL: Record<string, string> = { new: "nowa", invited: "wysłano prośbę o potwierdzenie", confirmed: "potwierdzona przez opiekuna", rejected: "odrzucona" };

const TOKEN_KEY = "admin-token";

/**
 * Leads for devices the official data does not know yet. Anyone can browse them;
 * with `admin` the operator also enters their token and decides on each one. A page that asks for the token
 * itself passes a way to read it as `token`, and then this list shows no token field of its own.
 */
export default function Candidates({ admin = false, token: sharedToken }: { admin?: boolean; token?: () => string }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("");
  const tokenField = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const result = useLoad(`candidates|${kind}|${version}`, async (signal) => {
    const { data } = await api.GET("/v1/candidates", { params: { query: { limit: 60, ...(kind ? { kind } : {}) } }, signal });
    if (!data) throw new Error("Nie udało się pobrać wskazówek. Spróbuj ponownie za chwilę.");
    return data;
  });

  // The operator types the token once per browser session, not on every visit to the panel.
  useEffect(() => {
    if (!tokenField.current) return;
    try {
      tokenField.current.value = sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {}
  }, [admin]);

  function rememberToken(value: string) {
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {}
  }

  async function decide(candidate: Candidate, decision: "invite" | "reject") {
    setError(null);
    const token = sharedToken ? sharedToken() : (tokenField.current?.value ?? "");
    const { data, response } = await api
      .POST("/v1/candidates/{id}/decision", { params: { path: { id: candidate.id } }, body: { decision }, headers: { Authorization: `Bearer ${token}` } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (!data) return setError(response?.status === 401 ? "Wpisz token administratora powyżej." : "Nie udało się zapisać decyzji. Spróbuj za chwilę.");
    if (data.confirmationUrl) setLinks({ ...links, [candidate.id]: data.confirmationUrl });
    setVersion(version + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <fieldset>
          <legend className="label text-sm">Źródło wskazówek</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {KINDS.map((option) => (
              <label key={option.value} className="chip">
                <input type="radio" name="rodzaj" value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} className="sr-only" />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        {admin && sharedToken === undefined && (
          <div className="space-y-1">
            <label htmlFor="token" className="label text-sm">
              Token administratora
            </label>
            <input id="token" type="password" autoComplete="off" ref={tokenField} onChange={(event) => rememberToken(event.target.value)} className="field w-64 py-1.5" />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-l-4 border-line border-l-danger p-3 text-danger">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <p aria-live="polite" className="text-sm text-muted">
          {result.state === "loading" && "Wczytuję…"}
          {result.state === "ready" &&
            (result.data.total === 0
              ? admin
                ? "Brak wskazówek. Uruchom zadanie „radar”."
                : "Brak wskazówek."
              : `Wskazówki: ${count(result.data.total)}${result.data.total > result.data.items.length ? ` (widać ${result.data.items.length} najważniejszych)` : ""}`)}
        </p>
        {result.state === "error" && (
          <p role="alert" className="text-danger">
            {result.message}
          </p>
        )}
        {result.state === "ready" && (
          <ul className="space-y-3">
            {result.data.items.map((candidate) => (
              <Lead key={candidate.id} candidate={candidate} link={links[candidate.id]} onDecide={admin ? (decision) => decide(candidate, decision) : undefined} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One lead. Without `onDecide` it is read-only: no decision buttons. */
function Lead({ candidate, link, onDecide }: { candidate: Candidate; link?: string; onDecide?: (decision: "invite" | "reject") => void }) {
  const meta = [KIND_LABEL[candidate.kind] ?? candidate.kind, candidate.locality, candidate.evidence.date].filter(Boolean);
  const open = onDecide !== undefined && (candidate.status === "new" || candidate.status === "invited");
  return (
    <li className="card space-y-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        {meta.join(" · ")}
        {candidate.status !== "new" && <span className="rounded bg-gov-light px-2 py-0.5 text-xs font-semibold text-gov">{STATUS_LABEL[candidate.status]}</span>}
      </p>
      <h2 className="font-semibold">{candidate.title}</h2>
      <blockquote className="border-l-4 border-line pl-3 text-sm">
        „{candidate.evidence.quote}”{" "}
        <a href={candidate.evidence.url} className="link">
          skąd to wiemy
        </a>
      </blockquote>
      {candidate.kind === "procurement" && candidate.registered !== null && (
        <p className="text-sm">
          W danych gminy: <strong>{candidate.registered}</strong>
          {candidate.devices !== null ? `, kupiono: ${candidate.devices}` : ""}
        </p>
      )}
      {link && (
        <div className="space-y-1 pt-1">
          <label htmlFor={`link-${candidate.id}`} className="label text-sm">
            Link dla opiekuna urządzenia
          </label>
          <input id={`link-${candidate.id}`} readOnly value={link} onFocus={(event) => event.target.select()} className="field w-full py-1 font-mono text-xs" />
        </div>
      )}
      {open && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => onDecide("invite")} className="btn btn-primary btn-sm">
            {candidate.status === "invited" ? "Pokaż link ponownie" : "Poproś o potwierdzenie"}
          </button>
          <button type="button" onClick={() => onDecide("reject")} className="btn btn-secondary btn-sm">
            Odrzuć
          </button>
        </div>
      )}
    </li>
  );
}
