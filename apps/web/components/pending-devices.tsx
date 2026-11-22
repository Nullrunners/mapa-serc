"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Status } from "@/components/ui";
import { ACCESS_LABEL, hours } from "@/lib/aed-text";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { dateTime, distance } from "@/lib/format";
import { googlePlace } from "@/lib/route";
import { useLoad } from "@/lib/use-load";

type Submission = components["schemas"]["DeviceSubmission"];
type Approval = components["schemas"]["DeviceApproval"];

const TOKEN_KEY = "admin-token";

/** What happened to the keeper's link, in the operator's words. */
const KEEPER_TEXT: Record<Approval["keeper"], string> = {
  sent: "Opiekun dostał naklejkę i link do panelu.",
  not_asked: "Urządzenie jest na mapie.",
  shared: "Połączone z urządzeniem instytucji, więc linku dla opiekuna nie wysłaliśmy.",
  has_keeper: "Urządzenie ma już opiekuna, więc linku nie wysłaliśmy.",
  not_published: "Urządzenie nie trafiło na mapę: sprawdź jego dane.",
};

/** "Szubińska 7, 86-005 Białe Błota". */
function addressOf(record: Submission["record"]): string | null {
  const street = [record.nazwa_ulicy, record.nr_budynku].filter(Boolean).join(" ");
  const town = [record.kod_pocztowy, record.miejscowosc].filter(Boolean).join(" ");
  return [street, town].filter(Boolean).join(", ") || null;
}

/** "przy wejściu · w budynku · dostęp publiczny · całą dobę": what the person said about the device. */
function detailsOf(record: Submission["record"]): string {
  return [
    record.opis_lokalizacji,
    record.wewnatrz_budynku === true ? "w budynku" : record.wewnatrz_budynku === false ? "na zewnątrz" : null,
    record.dostep ? ACCESS_LABEL[record.dostep] : null,
    record.godziny_dostepnosci ? hours(record.godziny_dostepnosci) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Single devices reported through the form. Approving one puts it on the map and into the shared source of user
 * reports; rejecting deletes it. The list itself needs the token, so it waits for one.
 */
export default function PendingDevices({ token }: { token: () => string }) {
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; approval: Approval } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // On the first load the token field may still be empty (it is filled from the session a moment later).
  const bearer = () => {
    let value = token();
    try {
      value ||= sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {}
    return { Authorization: `Bearer ${value}` };
  };

  const result = useLoad(`pending-devices|${version}`, async (signal) => {
    const { data, response } = await api.GET("/admin/device-submissions", { signal, headers: bearer() });
    if (response.status === 401) throw new Error("Wpisz token administratora powyżej i kliknij „Odśwież”.");
    if (!data) throw new Error("Nie udało się pobrać zgłoszeń. Spróbuj za chwilę.");
    return data.items;
  });

  async function approve(item: Submission) {
    setError(null);
    setBusy(item.id);
    const { data, response } = await api
      .POST("/admin/device-submissions/{id}/approve", { params: { path: { id: item.id } }, headers: bearer() })
      .catch(() => ({ data: undefined, response: undefined }));
    setBusy(null);
    if (!data) {
      return setError(response?.status === 401 ? "Wpisz token administratora powyżej." : response?.status === 503 ? "Rejestr gmin nie odpowiada. Spróbuj za chwilę." : "Nie udało się zatwierdzić. Spróbuj za chwilę.");
    }
    setDone({ name: item.record.nazwa ?? "Urządzenie", approval: data });
    setVersion(version + 1);
  }

  async function reject(item: Submission) {
    if (!window.confirm(`Odrzucić zgłoszenie „${item.record.nazwa ?? "bez nazwy"}”? Zostanie usunięte.`)) return;
    setError(null);
    setBusy(item.id);
    const { data, response } = await api
      .DELETE("/admin/device-submissions/{id}", { params: { path: { id: item.id } }, headers: bearer() })
      .catch(() => ({ data: undefined, response: undefined }));
    setBusy(null);
    if (!data) return setError(response?.status === 401 ? "Wpisz token administratora powyżej." : "Nie udało się odrzucić. Spróbuj za chwilę.");
    setDone(null);
    setVersion(version + 1);
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setVersion(version + 1)} className="btn btn-secondary btn-sm">
        Odśwież
      </button>
      {error && (
        <p role="alert" className="rounded-lg border border-l-4 border-line border-l-danger p-3 text-danger">
          {error}
        </p>
      )}
      {done && (
        <div role="status" className="card space-y-1 border-l-4 border-l-ok">
          <p>
            <strong>{done.name}</strong>: zatwierdzone. {KEEPER_TEXT[done.approval.keeper]}
          </p>
          {done.approval.device && (
            <Link href={`/aed/${done.approval.device.id}`} className="link text-sm">
              Zobacz raport urządzenia
            </Link>
          )}
        </div>
      )}
      {result.state === "loading" && <p className="text-sm text-muted">Wczytuję…</p>}
      {result.state === "error" && <p className="text-sm text-muted">{result.message}</p>}
      {result.state === "ready" && result.data.length === 0 && <p className="text-sm text-muted">Brak zgłoszeń, które czekają.</p>}
      {result.state === "ready" && result.data.length > 0 && (
        <ul className="space-y-3">
          {result.data.map((item) => {
            const { record } = item;
            const place = record.szerokosc_geograficzna !== null && record.dlugosc_geograficzna !== null ? { lat: record.szerokosc_geograficzna, lon: record.dlugosc_geograficzna } : null;
            const details = detailsOf(record);
            return (
              <li key={item.id} className="card space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                  <div className="space-y-0.5">
                    <p className="font-semibold">{record.nazwa ?? "Bez nazwy"}</p>
                    <p className="text-sm">
                      {addressOf(record) ?? "Adres nieznany"}
                      {place && (
                        <>
                          {" · "}
                          <ExternalLink href={googlePlace(place)}>miejsce na mapie</ExternalLink>
                        </>
                      )}
                    </p>
                    {details && <p className="text-sm">{details}</p>}
                    <p className="text-sm text-muted">
                      {item.keeperEmail ? `Opiekun: ${item.keeperEmail}` : "Zgłasza przechodzień"} · {dateTime(item.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => approve(item)} disabled={busy !== null} className="btn btn-primary btn-sm">
                      {busy === item.id ? "Chwilę…" : "Zatwierdź"}
                    </button>
                    <button type="button" onClick={() => reject(item)} disabled={busy !== null} className="btn btn-secondary btn-sm">
                      Odrzuć
                    </button>
                  </div>
                </div>
                {item.duplicateOf && (
                  <Status tone="warn" className="text-sm">
                    Wygląda na to samo co{" "}
                    <Link href={`/aed/${item.duplicateOf.id}`} className="link">
                      {item.duplicateOf.nazwa}
                    </Link>{" "}
                    ({distance(item.duplicateOf.distanceM)}, {item.duplicateOf.publication === "official" ? "potwierdzone" : "z OpenStreetMap"}).
                  </Status>
                )}
                {item.warnings.length > 0 && <p className="text-sm text-warn">{item.warnings.join(" ")}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
