"use client";

import { useEffect, useRef, useState } from "react";
import Candidates from "@/components/candidates";
import { api, API_URL, type SourceReport } from "@/lib/api/client";
import { count } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const TOKEN_KEY = "admin-token";

/** The operator's desk: submissions from the wizard waiting for approval, then the Radar leads. One token for both. */
export default function AdminPanel() {
  const field = useRef<HTMLInputElement>(null);
  const token = () => field.current?.value ?? "";

  // The operator types the token once per browser session, not on every visit to the panel.
  useEffect(() => {
    if (!field.current) return;
    try {
      field.current.value = sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {}
  }, []);

  function remember(value: string) {
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {}
  }

  return (
    <div className="space-y-10">
      <div className="max-w-xs space-y-1">
        <label htmlFor="token" className="label text-sm">
          Token administratora
        </label>
        <input id="token" type="password" autoComplete="off" ref={field} onChange={(event) => remember(event.target.value)} className="field w-full py-1.5" />
      </div>

      <section aria-labelledby="zgloszenia" className="space-y-4">
        <h2 id="zgloszenia" className="text-xl font-bold">
          Zgłoszenia do zatwierdzenia
        </h2>
        <PendingSources token={token} />
      </section>

      <section aria-labelledby="radar" className="space-y-4">
        <h2 id="radar" className="text-xl font-bold">
          Radar AED
        </h2>
        <Candidates admin token={token} />
      </section>
    </div>
  );
}

/** Wizard submissions that wait for the operator. Approving one publishes it and gives the provider its feed for dane.gov.pl. */
function PendingSources({ token }: { token: () => string }) {
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<{ name: string; feed: string | null; csv: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const result = useLoad(`pending-sources|${version}`, async (signal) => {
    const { data } = await api.GET("/v1/sources", { signal });
    if (!data) throw new Error("Nie udało się pobrać zgłoszeń. Spróbuj ponownie za chwilę.");
    return data.items.filter((source) => source.awaitingApproval);
  });

  async function approve(source: SourceReport) {
    setError(null);
    setBusy(source.id);
    const { data, response } = await api
      .POST("/admin/sources/{id}/approve", { params: { path: { id: source.id } }, headers: { Authorization: `Bearer ${token()}` } })
      .catch(() => ({ data: undefined, response: undefined }));
    setBusy(null);
    if (!data) return setError(response?.status === 401 ? "Wpisz token administratora powyżej." : "Nie udało się zatwierdzić. Spróbuj za chwilę.");
    setApproved({ name: source.name, feed: data.files.feed, csv: data.files.csv });
    setVersion(version + 1);
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-l-4 border-line border-l-danger p-3 text-danger">
          {error}
        </p>
      )}
      {approved && (
        <div role="status" className="card space-y-1 border-l-4 border-l-ok">
          <p>
            <strong>{approved.name}</strong>: zatwierdzone, urządzenia są na mapie.
          </p>
          {approved.feed && (
            <p className="text-sm">
              Plik dla dane.gov.pl:{" "}
              <a href={approved.feed} className="link break-all">
                {approved.feed}
              </a>
            </p>
          )}
        </div>
      )}
      {result.state === "loading" && <p className="text-sm text-muted">Wczytuję…</p>}
      {result.state === "error" && (
        <p role="alert" className="text-danger">
          {result.message}
        </p>
      )}
      {result.state === "ready" && result.data.length === 0 && <p className="text-sm text-muted">Brak zgłoszeń, które czekają.</p>}
      {result.state === "ready" && result.data.length > 0 && (
        <ul className="space-y-3">
          {result.data.map((source) => (
            <li key={source.id} className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div>
                <p className="font-semibold">{source.name}</p>
                <p className="text-sm text-muted">
                  Wierszy w pliku: {count(source.rows)} · licencja {source.licence} ·{" "}
                  <a href={`${API_URL}/v1/sources/${encodeURIComponent(source.id)}/aed.csv`} className="link">
                    dane (CSV)
                  </a>
                </p>
              </div>
              <button type="button" onClick={() => approve(source)} disabled={busy !== null} className="btn btn-primary btn-sm">
                {busy === source.id ? "Zatwierdzam…" : "Zatwierdź"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
