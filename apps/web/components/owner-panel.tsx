"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import KeeperHome, { KeeperBar } from "@/components/keeper-home";
import { LiveMessage, LoadStatus, TONE_TEXT, type Message } from "@/components/ui";
import { addressLine, title } from "@/lib/aed-text";
import { api, problemMessage } from "@/lib/api/client";
import { date, dateTime } from "@/lib/format";
import { REPORT_TEXT, expiryText, partName, reportedBy, type OwnerView } from "@/lib/passport-text";
import { loadAccount, loadLoginOptions, loginHref, readSession, sessionHeader } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const STATUS_CHOICES = [
  { value: "", label: "bez zmian" },
  { value: "czynny", label: "na miejscu i sprawne" },
  { value: "czasowo_niedostepny", label: "chwilowo niedostępne (serwis, remont)" },
  { value: "wycofany", label: "usunięte z tej lokalizacji" },
] as const;

const DELIVERY: Record<OwnerView["messages"][number]["status"], string> = {
  sent: "wysłano",
  logged: "zapisano, wysyłka wyłączona",
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

/**
 * The keeper's pages. With an owner link (`t`) or the number of a device of the logged-in keeper (`id`) in the
 * address it is the panel of that device; with neither, the keeper's start page.
 */
export default function OwnerPanel() {
  const params = useSearchParams();
  const token = params.get("t");
  const id = params.get("id");
  if (!token && !id) return <KeeperHome />;
  return <DevicePanel key={`${token}|${id}`} token={token} id={id} connect={params.get("polacz") === "1"} />;
}

/**
 * The keeper's side of the passport: expiry dates, contact for reminders, and "Potwierdzam sprawność".
 * `connect` means the person is back from logging in on the way to adding this device to their account.
 */
function DevicePanel({ token, id, connect }: { token: string | null; id: string | null; connect: boolean }) {
  const router = useRouter();
  /** How the API knows this person may manage the device: the owner link, the login, or both. */
  const access = () => ({ header: { ...(token ? { "x-owner-token": token } : {}), ...sessionHeader() }, query: token ? {} : { id: id ?? "" } });

  /** Puts the device of the owner link on the logged-in person's account and reads the panel again. */
  async function addToAccount(): Promise<OwnerView | null> {
    const session = readSession();
    if (!token || !session) return null;
    const added = await api.POST("/v1/account/devices", { params: { header: { "x-keeper-session": session, "x-owner-token": token } } }).catch(() => ({ data: undefined }));
    if (!added.data) return null;
    const { data } = await api.GET("/v1/owner/passport", { params: access() }).catch(() => ({ data: undefined }));
    return data ?? null;
  }

  const loaded = useLoad(`owner|${token}|${id}`, async (signal) => {
    const [login, account] = await Promise.all([loadLoginOptions(signal), token ? null : loadAccount(signal)]);
    if (!token && !account) return { view: null, login, refused: { text: "Zaloguj się, żeby wejść do panelu tego urządzenia.", login: true } };
    const { data, error: problem, response } = await api.GET("/v1/owner/passport", { params: access(), signal });
    if (!data && !token && response.status === 401) return { view: null, login, refused: { text: problemMessage(problem, "Tego urządzenia nie ma przy Twoim koncie."), login: false } };
    if (!data) throw new Error(problemMessage(problem, "Nie udało się wczytać raportu. Spróbuj ponownie za chwilę."));
    const view = connect && data.viewer && !data.viewer.linked ? ((await addToAccount()) ?? data) : data;
    return { view, login, refused: null };
  });
  const [updated, setView] = useState<OwnerView | null>(null);
  const [edited, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const view = updated ?? (loaded.state === "ready" ? loaded.data.view : null);
  const form = edited ?? (view ? formOf(view) : null);

  async function connectAccount() {
    setBusy(true);
    setMessage(null);
    const data = await addToAccount();
    setBusy(false);
    if (!data) return setMessage({ text: "Nie udało się dodać do konta. Zaloguj się jeszcze raz.", tone: "danger" });
    setView(data);
    setMessage({ text: "Gotowe. Teraz wystarczy logowanie.", tone: "ok" });
  }

  /** With an owner link the person stays in the panel, only without a name; without one there is nothing to stay in. */
  async function afterLogout() {
    if (!token) return router.replace("/opiekun");
    const { data } = await api.GET("/v1/owner/passport", { params: access() }).catch(() => ({ data: undefined }));
    if (data) setView(data);
  }

  async function confirm() {
    setBusy(true);
    setMessage(null);
    const { data, error: problem } = await api.POST("/v1/owner/passport/confirm", { params: access() }).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) return setMessage({ text: problemMessage(problem, "Nie udało się zapisać potwierdzenia."), tone: "danger" });
    setView(data);
    setMessage({ text: `Dziękujemy! Urządzenie oznaczone jako sprawne (${date(data.passport.confirmedAt ?? "")}).`, tone: "ok" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setMessage(null);
    const { data, error: problem } = await api
      .POST("/v1/owner/passport", {
        params: access(),
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
    setMessage({ text: "Zapisano. Przypomnimy 30 i 7 dni przed terminem.", tone: "ok" });
  }

  if (loaded.state === "ready" && loaded.data.refused) {
    const { refused, login } = loaded.data;
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Panel opiekuna</h1>
        <p>{refused.text}</p>
        {refused.login ? (
          login.mode !== "off" && (
            <Link href={loginHref(`/opiekun?id=${id}`)} className="btn btn-primary">
              Zaloguj się przez mObywatel
            </Link>
          )
        ) : (
          <p className="flex flex-wrap gap-2">
            <Link href={`/aed/${id}`} className="btn btn-secondary">
              Przejdź na stronę urządzenia
            </Link>
            <Link href="/opiekun" className="btn btn-secondary">
              Moje defibrylatory
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (!view || !form || loaded.state !== "ready") {
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
      {view.viewer && (
        <KeeperBar name={view.viewer.name} onLogout={afterLogout}>
          <Link href="/opiekun" className="link">
            Moje defibrylatory
          </Link>
        </KeeperBar>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-wide text-gov uppercase">Panel opiekuna</p>
        <h1 className="text-2xl font-bold text-balance">{title(view.aed)}</h1>
        {addressLine(view.aed) && <p>{addressLine(view.aed)}</p>}
      </div>

      <section aria-labelledby="potwierdz-naglowek" className="card space-y-3">
        <h2 id="potwierdz-naglowek" className="text-lg font-bold">
          Potwierdź, że urządzenie działa
        </h2>
        <p className="text-sm">Po przeglądzie: jest na miejscu, dioda miga, elektrody i bateria są ważne.</p>
        <p className="text-sm text-muted">
          {card.confirmedAt
            ? `Ostatnie potwierdzenie: ${date(card.confirmedAt)}${card.confirmedByKeeper ? "" : " (według źródła danych)"}${view.passport.confirmedBy ? `, ${view.passport.confirmedBy} po zalogowaniu przez mObywatel` : ""}.`
            : "Urządzenie nie ma jeszcze potwierdzenia."}
        </p>
        {expired.length > 0 && (
          <p className="text-sm font-semibold text-danger">
            Minął termin: {expired.map((item) => `${item.label} (${date(item.date ?? "")})`).join(", ")}. Po wymianie wpisz niżej nową datę.
          </p>
        )}
        {card.reports.problems.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-danger">Zgłoszone problemy. Sprawdź je przed potwierdzeniem:</p>
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
          <p className="hint">Daty są na opakowaniu elektrod i na baterii.</p>
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
            Nie publikujemy ich.{view.aed.record.email_kontaktowy ? ` Bez e-maila piszemy na ${view.aed.record.email_kontaktowy}.` : ""}
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

      {loaded.data.login.mode !== "off" && (
        <section aria-labelledby="logowanie-naglowek" className="space-y-2 border-t border-line pt-6">
          <h2 id="logowanie-naglowek" className="text-lg font-bold">
            Wejście bez linku
          </h2>
          {view.viewer?.linked ? (
            <p className="text-sm">Urządzenie jest przy Twoim koncie. Wystarczy logowanie przez mObywatel.</p>
          ) : view.viewer ? (
            <>
              <p className="text-sm">Dodaj je do konta, a następnym razem wejdziesz bez linku.</p>
              <button type="button" disabled={busy} onClick={connectAccount} className="btn btn-secondary">
                Dodaj do mojego konta
              </button>
            </>
          ) : (
            <>
              <p className="text-sm">Zaloguj się, a następnym razem wejdziesz bez linku.</p>
              <Link href={loginHref(`/opiekun?t=${encodeURIComponent(token ?? "")}&polacz=1`)} className="btn btn-secondary">
                Zaloguj się przez mObywatel
              </Link>
            </>
          )}
          {view.keepers.length > 0 && <p className="text-sm text-muted">Bez linku wchodzą: {view.keepers.map((keeper) => `${keeper.name} (od ${date(keeper.linkedAt)})`).join(", ")}.</p>}
        </section>
      )}

      <section aria-labelledby="naklejka-naglowek" className="space-y-2 border-t border-line pt-6">
        <h2 id="naklejka-naglowek" className="text-lg font-bold">
          Naklejka z kodem QR
        </h2>
        <p className="text-sm">Przyklej przy urządzeniu. Przechodnie zgłoszą przez nią problem.</p>
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
