"use client";

import { useState } from "react";
import { api, type Candidate } from "@/lib/api/client";
import { useLoad } from "@/lib/use-load";

const KINDS = [
  { value: "", label: "Wszystkie" },
  { value: "procurement", label: "Zakupy publiczne" },
  { value: "osm_gap", label: "Mapa społeczności" },
] as const;

const KIND_LABEL: Record<string, string> = { osm_gap: "mapa społeczności", procurement: "zakup publiczny", web: "strona urzędu" };
const STATUS_LABEL: Record<string, string> = { new: "nowa", invited: "wysłano prośbę o potwierdzenie", confirmed: "potwierdzona przez opiekuna", rejected: "odrzucona" };

export default function Candidates() {
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("");
  const [token, setToken] = useState("");
  const [version, setVersion] = useState(0);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const result = useLoad(`candidates|${kind}|${version}`, async (signal) => {
    const { data } = await api.GET("/v1/candidates", { params: { query: { limit: 60, ...(kind ? { kind } : {}) } }, signal });
    if (!data) throw new Error("Nie udało się pobrać wskazówek. Spróbuj ponownie za chwilę.");
    return data;
  });

  async function decide(candidate: Candidate, decision: "invite" | "reject") {
    setError(null);
    const { data, response } = await api
      .POST("/v1/candidates/{id}/decision", { params: { path: { id: candidate.id } }, body: { decision }, headers: { Authorization: `Bearer ${token}` } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (!data) return setError(response?.status === 401 ? "Ta czynność wymaga tokenu operatora. Wpisz go w polu powyżej." : "Nie udało się zapisać decyzji. Spróbuj ponownie za chwilę.");
    if (data.confirmationUrl) setLinks({ ...links, [candidate.id]: data.confirmationUrl });
    setVersion(version + 1);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <fieldset>
          <legend className="text-sm font-semibold">Źródło wskazówek</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {KINDS.map((option) => (
              <label key={option.value} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${kind === option.value ? "border-gov bg-gov font-semibold text-white" : "border-line"}`}>
                <input type="radio" name="rodzaj" value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} className="sr-only" />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="token" className="block text-sm font-semibold">
            Token operatora
          </label>
          <input id="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} aria-describedby="token-opis" className="mt-1 w-64 rounded border border-muted px-3 py-1.5" />
          <p id="token-opis" className="text-xs text-muted">
            Potrzebny tylko do decyzji. Przeglądanie wskazówek jest otwarte.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded border-2 border-danger p-3 text-danger">
          {error}
        </p>
      )}

      <div aria-live="polite">
        {result.state === "loading" && <p className="text-muted">Wczytuję…</p>}
        {result.state === "error" && (
          <p role="alert" className="text-danger">
            {result.message}
          </p>
        )}
        {result.state === "ready" && (
          <>
            <p className="text-sm text-muted">
              {result.data.total === 0 ? "Brak wskazówek. Uruchom zadanie „radar”, żeby je zbudować." : `Wskazówek: ${result.data.total.toLocaleString("pl-PL")}; pokazuję ${result.data.items.length} największych.`}
            </p>
            <ul className="mt-3 space-y-3">
              {result.data.items.map((candidate) => (
                <li key={candidate.id} className="rounded border border-line p-4">
                  <p className="text-sm text-muted">
                    {KIND_LABEL[candidate.kind] ?? candidate.kind}
                    {candidate.locality ? ` · ${candidate.locality}` : ""}
                    {candidate.evidence.date ? ` · ${candidate.evidence.date}` : ""}
                    {candidate.status !== "new" && <span className="ml-2 rounded bg-gov-light px-2 py-0.5 font-semibold text-gov">{STATUS_LABEL[candidate.status]}</span>}
                  </p>
                  <h2 className="font-semibold">{candidate.title}</h2>
                  <blockquote className="mt-1 border-l-4 border-line pl-3 text-sm">
                    „{candidate.evidence.quote}”{" "}
                    <a href={candidate.evidence.url} className="text-gov underline">
                      zobacz źródło
                    </a>
                  </blockquote>
                  {candidate.kind === "procurement" && candidate.registered !== null && (
                    <p className="mt-1 text-sm">
                      W zbiorze urzędowym w gminie zamawiającego: <strong>{candidate.registered}</strong>
                      {candidate.devices !== null ? `, kupiono: ${candidate.devices}` : ""}.
                    </p>
                  )}
                  {links[candidate.id] && (
                    <div className="mt-3">
                      <label htmlFor={`link-${candidate.id}`} className="block text-sm font-semibold">
                        Link dla opiekuna – wyślij go e-mailem
                      </label>
                      <input id={`link-${candidate.id}`} readOnly value={links[candidate.id]} onFocus={(event) => event.target.select()} className="mt-1 w-full rounded border border-muted px-2 py-1 font-mono text-xs" />
                    </div>
                  )}
                  {(candidate.status === "new" || candidate.status === "invited") && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => decide(candidate, "invite")} className="rounded bg-gov px-3 py-1.5 text-sm font-semibold text-white hover:bg-gov-dark">
                        {candidate.status === "invited" ? "Pokaż link ponownie" : "Poproś o potwierdzenie"}
                      </button>
                      <button type="button" onClick={() => decide(candidate, "reject")} className="rounded border-2 border-gov px-3 py-1.5 text-sm font-semibold text-gov">
                        Odrzuć
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
