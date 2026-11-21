"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { addressLine, date, title } from "@/lib/aed-text";
import { REPORT_TEXT, dateTime, expiryText, type OwnerView } from "@/lib/passport-text";
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

const problemText = (error: unknown, fallback: string) => {
  const problem = error as { detail?: string; issues?: { message: string }[] } | undefined;
  return problem?.issues?.[0]?.message ?? problem?.detail ?? fallback;
};

/** The keeper's side of the passport: expiry dates, contact for reminders, and "Potwierdzam sprawność". */
export default function OwnerPanel() {
  const loaded = useLoad("owner", async (signal) => {
    const token = new URLSearchParams(window.location.search).get("t");
    if (!token) throw new Error("W adresie brakuje kodu dostępu. Otwórz link z wiadomości od nas jeszcze raz.");
    const { data, error: problem } = await api.GET("/v1/owner/passport", { params: { header: { "x-owner-token": token } }, signal });
    if (!data) throw new Error(problemText(problem, "Nie udało się wczytać paszportu. Spróbuj ponownie za chwilę."));
    return { token, view: data };
  });
  const [updated, setView] = useState<OwnerView | null>(null);
  const [edited, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const token = loaded.state === "ready" ? loaded.data.token : null;
  const view = updated ?? (loaded.state === "ready" ? loaded.data.view : null);
  const form = edited ?? (view ? formOf(view) : null);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setNotice(null);
    const { data, error: problem } = await api.POST("/v1/owner/passport/confirm", { params: { header: { "x-owner-token": token } } });
    setBusy(false);
    if (!data) return setError(problemText(problem, "Nie udało się zapisać potwierdzenia."));
    setView(data);
    setNotice(`Dziękujemy! W otwartym zbiorze danych urządzenie jest od teraz oznaczone jako sprawne i sprawdzone ${date(data.passport.confirmedAt ?? "")}.`);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token || !form) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const { data, error: problem } = await api.POST("/v1/owner/passport", {
      params: { header: { "x-owner-token": token } },
      body: {
        electrodesExp: form.electrodesExp || null,
        electrodesChildExp: form.electrodesChildExp || null,
        batteryExp: form.batteryExp || null,
        status: (form.status || null) as OwnerView["passport"]["status"],
        notifyEmail: form.notifyEmail || null,
        notifyPhone: form.notifyPhone || null,
      },
    });
    setBusy(false);
    if (!data) return setError(problemText(problem, "Nie udało się zapisać zmian."));
    setView(data);
    setForm(formOf(data));
    setNotice("Zapisaliśmy zmiany. Przypomnimy o wymianie 30 i 7 dni przed terminem.");
  }

  if (!view || !form) {
    return (
      <div aria-live="polite" className="max-w-2xl">
        {loaded.state === "error" ? (
          <p role="alert" className="text-danger">
            {loaded.message}
          </p>
        ) : (
          <p className="text-muted">Wczytuję…</p>
        )}
      </div>
    );
  }

  const field = (key: keyof Form) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }) });
  const { public: card } = view;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-gov">Paszport defibrylatora: panel opiekuna</p>
        <h1 className="text-2xl font-bold">{title(view.aed)}</h1>
        {addressLine(view.aed) && <p>{addressLine(view.aed)}</p>}
      </div>

      <section aria-labelledby="potwierdz-naglowek" className="space-y-3 rounded border border-line p-4">
        <h2 id="potwierdz-naglowek" className="text-lg font-bold">
          Potwierdź, że urządzenie działa
        </h2>
        <p className="text-sm">Kliknij po przeglądzie: urządzenie jest na miejscu, zielona dioda miga, a elektrody i bateria są ważne.</p>
        <p className="text-sm">
          {card.confirmedAt ? `Ostatnie potwierdzenie: ${date(card.confirmedAt)}${card.confirmedByKeeper ? "" : " (według źródła danych)"}.` : "Urządzenie nie ma jeszcze potwierdzenia."}
        </p>
        <button type="button" disabled={busy} onClick={confirm} className="w-full rounded bg-ok px-4 py-4 text-lg font-bold text-white hover:opacity-90 disabled:opacity-60 sm:w-auto">
          ✓ Potwierdzam sprawność
        </button>
        {card.reports.problems.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-danger">Przechodnie zgłosili problem. Sprawdź urządzenie, zanim potwierdzisz sprawność:</p>
            <ul className="list-disc pl-6">
              {card.reports.problems.map((problem) => (
                <li key={problem.kind}>
                  {REPORT_TEXT[problem.kind]}
                  {problem.count > 1 ? ` (${problem.count} razy)` : ""}, ostatnio {dateTime(problem.lastAt)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p aria-live="polite" className="font-semibold text-ok">
        {notice}
      </p>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}

      <form onSubmit={save} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-lg font-bold">Terminy ważności</legend>
          <p className="text-sm text-muted">Daty znajdziesz na opakowaniu elektrod i na baterii. Przypomnimy o wymianie 30 i 7 dni wcześniej.</p>
          {card.items.map((item) => {
            const key = item.item === "electrodes" ? "electrodesExp" : item.item === "electrodes_child" ? "electrodesChildExp" : "batteryExp";
            const expiry = expiryText(item);
            return (
              <div key={item.item} className="grid gap-1 sm:grid-cols-[14rem_auto_1fr] sm:items-center sm:gap-3">
                <label htmlFor={key} className="font-semibold">
                  {item.label[0]!.toUpperCase() + item.label.slice(1)}
                </label>
                <input id={key} type="date" {...field(key)} className="rounded border border-line px-3 py-2" />
                {item.date && <span className={`text-sm ${expiry.tone}`}>{expiry.text}</span>}
              </div>
            );
          })}
          <div className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-3">
            <label htmlFor="status" className="font-semibold">
              Stan urządzenia
            </label>
            <select id="status" {...field("status")} className="rounded border border-line px-3 py-2">
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
          <p className="text-sm text-muted">
            Tych danych nie publikujemy. Bez adresu e-mail napiszemy na adres podany w danych urządzenia{view.aed.record.email_kontaktowy ? ` (${view.aed.record.email_kontaktowy})` : ""}.
          </p>
          <div className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-3">
            <label htmlFor="notifyEmail" className="font-semibold">
              E-mail
            </label>
            <input id="notifyEmail" type="email" autoComplete="email" {...field("notifyEmail")} className="rounded border border-line px-3 py-2" />
          </div>
          <div className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-3">
            <label htmlFor="notifyPhone" className="font-semibold">
              Telefon komórkowy (SMS)
            </label>
            <input id="notifyPhone" type="tel" autoComplete="tel" placeholder="np. 600 100 200" {...field("notifyPhone")} className="rounded border border-line px-3 py-2" />
          </div>
        </fieldset>

        <button type="submit" disabled={busy} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark disabled:opacity-60">
          Zapisz zmiany
        </button>
      </form>

      <section aria-labelledby="naklejka-naglowek" className="space-y-1">
        <h2 id="naklejka-naglowek" className="text-lg font-bold">
          Naklejka z kodem QR
        </h2>
        <p className="text-sm">Przyklej ją przy urządzeniu. Kto ją zeskanuje, może potwierdzić, że defibrylator jest na miejscu, albo zgłosić Ci problem.</p>
        <p className="flex flex-wrap gap-x-5 text-sm font-semibold">
          <Link href={`/aed/${view.aed.id}/naklejka`} className="text-gov underline">
            Wydrukuj naklejkę
          </Link>
          <Link href={`/aed/${view.aed.id}`} className="text-gov underline">
            Zobacz stronę urządzenia
          </Link>
        </p>
      </section>

      {view.reports.length > 0 && (
        <section aria-labelledby="zgloszenia-naglowek" className="space-y-1">
          <h2 id="zgloszenia-naglowek" className="text-lg font-bold">
            Zgłoszenia przechodniów
          </h2>
          <ul className="space-y-0.5 text-sm">
            {view.reports.map((report) => (
              <li key={report.at + report.kind}>
                {dateTime(report.at)}: {REPORT_TEXT[report.kind]}
                {report.note ? ` – „${report.note}”` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.messages.length > 0 && (
        <section aria-labelledby="wiadomosci-naglowek" className="space-y-1">
          <h2 id="wiadomosci-naglowek" className="text-lg font-bold">
            Wiadomości od nas
          </h2>
          <ul className="space-y-0.5 text-sm">
            {view.messages.map((message) => (
              <li key={message.at + message.channel + message.subject}>
                {dateTime(message.at)}, {message.channel === "sms" ? "SMS" : "e-mail"} na {message.recipient}: {message.subject} ({DELIVERY[message.status]})
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
