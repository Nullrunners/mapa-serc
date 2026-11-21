"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LiveMessage, LoadStatus, TONE_TEXT, type Message } from "@/components/ui";
import { addressLine, title } from "@/lib/aed-text";
import { api, problemMessage } from "@/lib/api/client";
import { date, dateTime } from "@/lib/format";
import { REPORT_TEXT, expiryText, partName, reportedBy, type OwnerView } from "@/lib/passport-text";
import { useLoad } from "@/lib/use-load";

const STATUS_CHOICES = [
  { value: "", label: "bez zmian (tak, jak podaje źródło danych)" },
  { value: "czynny", label: "na miejscu i sprawne" },
  { value: "czasowo_niedostepny", label: "chwilowo niedostępne, np. serwis albo remont" },
  { value: "wycofany", label: "usunięte z tej lokalizacji" },
] as const;

const DELIVERY: Record<OwnerView["messages"][number]["status"], string> = {
  sent: "wysłano",
  logged: "zapisano (wysyłka w tym serwisie jest wyłączona)",
  failed: "nie udało się wysłać",
};

const EXPIRY_FIELD = { electrodes: "electrodesExp", electrodes_child: "electrodesChildExp", battery: "batteryExp" } as const;

interface Form {
  electrodesExp: string;
  electrodesChildExp: string;
  batteryExp: string;
  status: string;
  notifyEmail: string;
  notifyPhone: string;
}

const formOf = (view: OwnerView): Form => ({
  electrodesExp: view.passport.electrodesExp ?? "",
  electrodesChildExp: view.passport.electrodesChildExp ?? "",
  batteryExp: view.passport.batteryExp ?? "",
  status: view.passport.status ?? "",
  notifyEmail: view.passport.notifyEmail ?? "",
  notifyPhone: view.passport.notifyPhone ?? "",
});

/** One labelled row of the form: the label in a fixed column on a wide screen, above the field on a phone. */
const ROW = "grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-3";

/** The keeper's side of the passport: expiry dates, contact for reminders, and "Potwierdzam sprawność". */
export default function OwnerPanel() {
  const loaded = useLoad("owner", async (signal) => {
    const token = new URLSearchParams(window.location.search).get("t");
    if (!token) throw new Error("W adresie brakuje kodu dostępu. Otwórz link z wiadomości od nas jeszcze raz.");
    const { data, error: problem } = await api.GET("/v1/owner/passport", { params: { header: { "x-owner-token": token } }, signal });
    if (!data) throw new Error(problemMessage(problem, "Nie udało się wczytać paszportu. Spróbuj ponownie za chwilę."));
    return { token, view: data };
  });
  const [updated, setView] = useState<OwnerView | null>(null);
  const [edited, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const token = loaded.state === "ready" ? loaded.data.token : null;
  const view = updated ?? (loaded.state === "ready" ? loaded.data.view : null);
  const form = edited ?? (view ? formOf(view) : null);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setMessage(null);
    const { data, error: problem } = await api.POST("/v1/owner/passport/confirm", { params: { header: { "x-owner-token": token } } }).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) return setMessage({ text: problemMessage(problem, "Nie udało się zapisać potwierdzenia."), tone: "danger" });
    setView(data);
    setMessage({ text: `Dziękujemy! W otwartym zbiorze danych urządzenie jest od teraz oznaczone jako sprawne i sprawdzone ${date(data.passport.confirmedAt ?? "")}.`, tone: "ok" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token || !form) return;
    setBusy(true);
    setMessage(null);
    const { data, error: problem } = await api
      .POST("/v1/owner/passport", {
        params: { header: { "x-owner-token": token } },
        body: {
          electrodesExp: form.electrodesExp || null,
          electrodesChildExp: form.electrodesChildExp || null,
          batteryExp: form.batteryExp || null,
          status: (form.status || null) as OwnerView["passport"]["status"],
          notifyEmail: form.notifyEmail || null,
          notifyPhone: form.notifyPhone || null,
        },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) return setMessage({ text: problemMessage(problem, "Nie udało się zapisać zmian."), tone: "danger" });
    setView(data);
    setForm(formOf(data));
    setMessage({ text: "Zapisaliśmy zmiany. Przypomnimy o wymianie 30 i 7 dni przed terminem.", tone: "ok" });
  }

  if (!view || !form) {
    return (
      <div aria-live="polite" className="max-w-2xl">
        <LoadStatus of={loaded} />
      </div>
    );
  }

  const field = (key: keyof Form) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }) });
  const { public: card } = view;
  // A keeper may still confirm (they decide about the status), but should not do it by mistake over an old date.
  const expired = card.items.filter((item) => item.state === "expired");

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-wide text-gov uppercase">Paszport defibrylatora: panel opiekuna</p>
        <h1 className="text-2xl font-bold text-balance">{title(view.aed)}</h1>
        {addressLine(view.aed) && <p>{addressLine(view.aed)}</p>}
      </div>

      <section aria-labelledby="potwierdz-naglowek" className="card space-y-3">
        <h2 id="potwierdz-naglowek" className="text-lg font-bold">
          Potwierdź, że urządzenie działa
        </h2>
        <p className="text-sm">Kliknij po przeglądzie: urządzenie jest na miejscu, zielona dioda miga, a elektrody i bateria są ważne.</p>
        <p className="text-sm text-muted">
          {card.confirmedAt ? `Ostatnie potwierdzenie: ${date(card.confirmedAt)}${card.confirmedByKeeper ? "" : " (według źródła danych)"}.` : "Urządzenie nie ma jeszcze potwierdzenia."}
        </p>
        {expired.length > 0 && (
          <p className="text-sm font-semibold text-danger">
            Minął termin: {expired.map((item) => `${item.label} (${date(item.date ?? "")})`).join(", ")}. Po wymianie wpisz niżej nową datę, a dopiero potem potwierdź sprawność.
          </p>
        )}
        {card.reports.problems.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-danger">Przechodnie zgłosili problem. Sprawdź urządzenie, zanim potwierdzisz sprawność:</p>
            <ul className="list-disc pl-6">
              {card.reports.problems.map((problem) => (
                <li key={problem.kind}>
                  {REPORT_TEXT[problem.kind]}
                  {reportedBy(problem.count)}, ostatnio {dateTime(problem.lastAt)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" disabled={busy} onClick={confirm} className="btn btn-ok btn-lg w-full sm:w-auto">
          <span>
            <span aria-hidden>✓ </span>
            Potwierdzam sprawność
          </span>
        </button>
      </section>

      <LiveMessage message={message} />

      <form onSubmit={save} className="space-y-8">
        <fieldset className="space-y-3">
          <legend className="text-lg font-bold">Terminy ważności</legend>
          <p className="hint">Daty znajdziesz na opakowaniu elektrod i na baterii. Przypomnimy o wymianie 30 i 7 dni wcześniej.</p>
          {card.items.map((item) => {
            const key = EXPIRY_FIELD[item.item];
            const expiry = expiryText(item);
            return (
              <div key={item.item} className="grid gap-1 sm:grid-cols-[14rem_auto_1fr] sm:items-center sm:gap-3">
                <label htmlFor={key} className="label">
                  {partName(item)}
                </label>
                <input id={key} type="date" {...field(key)} className="field" />
                {item.date && <span className={`text-sm ${TONE_TEXT[expiry.tone]}`}>{expiry.text}</span>}
              </div>
            );
          })}
          <div className={ROW}>
            <label htmlFor="status" className="label">
              Stan urządzenia
            </label>
            <select id="status" {...field("status")} className="field">
              {STATUS_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-bold">Gdzie wysyłać przypomnienia</legend>
          <p className="hint">
            Tych danych nie publikujemy. Bez adresu e-mail napiszemy na adres podany w danych urządzenia{view.aed.record.email_kontaktowy ? ` (${view.aed.record.email_kontaktowy})` : ""}.
          </p>
          <div className={ROW}>
            <label htmlFor="notifyEmail" className="label">
              E-mail
            </label>
            <input id="notifyEmail" type="email" autoComplete="email" {...field("notifyEmail")} className="field" />
          </div>
          <div className={ROW}>
            <label htmlFor="notifyPhone" className="label">
              Telefon komórkowy (SMS)
            </label>
            <input id="notifyPhone" type="tel" autoComplete="tel" placeholder="np. 600 100 200" {...field("notifyPhone")} className="field" />
          </div>
        </fieldset>

        <button type="submit" disabled={busy} className="btn btn-primary">
          Zapisz zmiany
        </button>
      </form>

      <section aria-labelledby="naklejka-naglowek" className="space-y-2 border-t border-line pt-6">
        <h2 id="naklejka-naglowek" className="text-lg font-bold">
          Naklejka z kodem QR
        </h2>
        <p className="text-sm">Przyklej ją przy urządzeniu. Kto ją zeskanuje, może potwierdzić, że defibrylator jest na miejscu, albo zgłosić Ci problem.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`/aed/${view.aed.id}/naklejka`} className="btn btn-secondary btn-sm">
            Wydrukuj naklejkę
          </Link>
          <Link href={`/aed/${view.aed.id}`} className="btn btn-secondary btn-sm">
            Zobacz stronę urządzenia
          </Link>
        </div>
      </section>

      {view.reports.length > 0 && (
        <section aria-labelledby="zgloszenia-naglowek" className="space-y-2">
          <h2 id="zgloszenia-naglowek" className="text-lg font-bold">
            Zgłoszenia przechodniów
          </h2>
          <ul className="divide-y divide-line text-sm">
            {view.reports.map((report) => (
              <li key={report.at + report.kind} className="py-1.5">
                <span className="text-muted">{dateTime(report.at)}:</span> {REPORT_TEXT[report.kind]}
                {report.note ? ` – „${report.note}”` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.messages.length > 0 && (
        <section aria-labelledby="wiadomosci-naglowek" className="space-y-2">
          <h2 id="wiadomosci-naglowek" className="text-lg font-bold">
            Wiadomości od nas
          </h2>
          <ul className="divide-y divide-line text-sm">
            {view.messages.map((message) => (
              <li key={message.at + message.channel + message.subject} className="py-1.5">
                <span className="text-muted">{dateTime(message.at)}:</span> {message.channel === "sms" ? "SMS" : "e-mail"} na {message.recipient}: {message.subject} ({DELIVERY[message.status]})
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
