"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type AedItem } from "@/lib/api/client";
import { ACCESS_LABEL, AVAILABLE_NOW, STATUS_WARNING, addressLine, date, hours, title } from "@/lib/aed-text";
import { PROBLEMS, REPORT_BUTTON, REPORT_TEXT, dateTime, expiryText, reportedBy, type PassportPublic, type ReportKind } from "@/lib/passport-text";
import { useLoad } from "@/lib/use-load";

/**
 * The page behind the QR sticker. Someone who scans it may be in an emergency, so 112 comes first;
 * everyone else can say in one tap that the device is there, or report a problem to its keeper.
 */
export default function Passport({ id }: { id: string }) {
  const [passport, setPassport] = useState<PassportPublic | null>(null);
  const loaded = useLoad(id, async (signal) => {
    const [one, card] = await Promise.all([api.GET("/v1/aed/{id}", { params: { path: { id } }, signal }), api.GET("/v1/aed/{id}/passport", { params: { path: { id } }, signal })]);
    if (one.response.status === 404) throw new Error("Nie znamy defibrylatora o tym numerze. Sprawdź, czy adres z naklejki przepisał się w całości.");
    if (!one.data || !card.data) throw new Error("Nie udało się wczytać informacji o urządzeniu. Spróbuj ponownie za chwilę.");
    return { item: one.data as AedItem, passport: card.data };
  });

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <p className="rounded border-2 border-danger bg-white p-3 font-semibold">
        Ktoś stracił przytomność? Dzwoń <a href="tel:112" className="text-danger underline">112</a>. Włącz defibrylator i rób to, co mówi.
      </p>

      <div aria-live="polite">
        {loaded.state === "loading" && <p className="text-muted">Wczytuję…</p>}
        {loaded.state === "error" && (
          <p role="alert" className="text-danger">
            {loaded.message}
          </p>
        )}
      </div>

      {loaded.state === "ready" && <Card item={loaded.data.item} passport={passport ?? loaded.data.passport} onPassport={setPassport} />}
    </div>
  );
}

function Card({ item, passport, onPassport }: { item: AedItem; passport: PassportPublic; onPassport: (passport: PassportPublic) => void }) {
  const { record } = item;
  const warning = STATUS_WARNING[record.status];
  const where = [record.opis_lokalizacji, record.pietro ? `piętro: ${record.pietro}` : null].filter(Boolean).join(", ");
  const access = [record.dostep ? ACCESS_LABEL[record.dostep] : null, record.uwagi_dostepu].filter(Boolean).join(". ");
  const items = passport.items.filter((entry) => entry.date);

  return (
    <>
      <section aria-labelledby="paszport-naglowek" className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-gov">Paszport defibrylatora</p>
        <h1 id="paszport-naglowek" className="text-2xl font-bold">
          {title(item)}
        </h1>
        {addressLine(item) && <p>{addressLine(item)}</p>}
        {where && <p className="text-sm text-muted">{where}</p>}
        {warning && <p className="font-semibold text-danger">{warning}</p>}
        <p className={`font-semibold ${AVAILABLE_NOW[item.availableNow].tone}`}>{AVAILABLE_NOW[item.availableNow].label}</p>
        {record.godziny_dostepnosci && <p className="text-sm">Godziny: {hours(record.godziny_dostepnosci)}</p>}
        {access && <p className="text-sm">Dostęp: {access}</p>}
      </section>

      <Report id={item.id} onPassport={onPassport} />

      <section aria-labelledby="stan-naglowek" className="space-y-2 rounded border border-line p-4">
        <h2 id="stan-naglowek" className="font-bold">
          Stan urządzenia
        </h2>
        <ul className="space-y-1 text-sm">
          <li>
            {passport.confirmedAt
              ? `Opiekun ${passport.confirmedByKeeper ? "potwierdził" : "zgłosił"} sprawność: ${date(passport.confirmedAt)}`
              : "Opiekun jeszcze nie potwierdził sprawności w paszporcie."}
          </li>
          {passport.reports.lastOk && <li>Ostatnio ktoś sprawdził, że jest na miejscu: {dateTime(passport.reports.lastOk)}</li>}
          {passport.reports.problems.map((problem) => (
            <li key={problem.kind} className="font-semibold text-danger">
              Zgłoszono: {REPORT_TEXT[problem.kind]}
              {reportedBy(problem.count)}, ostatnio {dateTime(problem.lastAt)}. Opiekun dostał wiadomość.
            </li>
          ))}
          {items.map((entry) => {
            const expiry = expiryText(entry);
            return (
              <li key={entry.item}>
                {entry.label[0]!.toUpperCase() + entry.label.slice(1)}: <span className={`font-semibold ${expiry.tone}`}>{expiry.text}</span>
              </li>
            );
          })}
        </ul>
        {item.publication === "community" && (
          <p className="text-sm text-warn">Dane tego urządzenia pochodzą z OpenStreetMap i nikt z instytucji ich jeszcze nie potwierdził.</p>
        )}
      </section>

      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${record.szerokosc_geograficzna},${record.dlugosc_geograficzna}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block font-semibold text-gov underline"
      >
        Pokaż drogę w Mapach Google<span className="sr-only"> (otworzy się w nowej karcie)</span>
      </a>

      <Keeper id={item.id} passport={passport} />
    </>
  );
}

function Report({ id, onPassport }: { id: string; onPassport: (passport: PassportPublic) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: string } | null>(null);

  async function send(kind: ReportKind) {
    setBusy(true);
    setMessage(null);
    const { data } = await api.POST("/v1/aed/{id}/reports", { params: { path: { id } }, body: { kind } });
    setBusy(false);
    setOpen(false);
    if (!data) return setMessage({ text: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.", tone: "text-danger" });
    onPassport(data.passport);
    if (data.outcome === "duplicate") return setMessage({ text: "Twoje zgłoszenie z ostatniej godziny już mamy. Dziękujemy!", tone: "text-ok" });
    if (data.outcome === "limit") return setMessage({ text: "Na dziś przyjęliśmy już wiele zgłoszeń o tym urządzeniu albo od Ciebie. Spróbuj jutro.", tone: "text-warn" });
    setMessage(
      kind === "ok"
        ? { text: "Dziękujemy! Dzięki Tobie wiadomo, że ten defibrylator jest gotowy do użycia.", tone: "text-ok" }
        : { text: "Dziękujemy! Przekazaliśmy zgłoszenie opiekunowi urządzenia.", tone: "text-ok" },
    );
  }

  return (
    <section aria-labelledby="zglos-naglowek" className="space-y-3">
      <h2 id="zglos-naglowek" className="font-bold">
        Przechodzisz obok? Daj znać, w jakim stanie jest urządzenie
      </h2>
      <button type="button" disabled={busy} onClick={() => send("ok")} className="w-full rounded bg-ok px-4 py-4 text-lg font-bold text-white hover:opacity-90 disabled:opacity-60">
        ✓ {REPORT_BUTTON.ok}
      </button>
      <button
        type="button"
        disabled={busy}
        aria-expanded={open}
        aria-controls="problemy"
        onClick={() => setOpen(!open)}
        className="w-full rounded border-2 border-danger px-4 py-3 font-bold text-danger hover:bg-red-50 disabled:opacity-60"
      >
        Zgłoś problem
      </button>
      {open && (
        <ul id="problemy" className="space-y-2">
          {PROBLEMS.map((kind) => (
            <li key={kind}>
              <button type="button" disabled={busy} onClick={() => send(kind)} className="w-full rounded border border-line px-4 py-3 text-left font-semibold hover:bg-gov-light disabled:opacity-60">
                {REPORT_BUTTON[kind]}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className={`font-semibold ${message?.tone ?? ""}`}>
        {message?.text}
      </p>
    </section>
  );
}

function Keeper({ id, passport }: { id: string; passport: PassportPublic }) {
  const [state, setState] = useState<{ text: string; tone: string } | null>(null);

  async function request() {
    const { data, error } = await api.POST("/v1/aed/{id}/passport/link", { params: { path: { id } } });
    if (data) setState({ text: `Wysłaliśmy link na adres ${data.sentTo}. Sprawdź skrzynkę.`, tone: "text-ok" });
    else setState({ text: (error as { detail?: string } | undefined)?.detail ?? "Nie udało się wysłać linku. Spróbuj ponownie za chwilę.", tone: "text-danger" });
  }

  return (
    <section aria-labelledby="opiekun-naglowek" className="space-y-2 border-t border-line pt-4 text-sm">
      <h2 id="opiekun-naglowek" className="font-bold">
        Opiekujesz się tym defibrylatorem?
      </h2>
      <p>
        W paszporcie wpiszesz terminy ważności elektrod i baterii. Przypomnimy Ci o wymianie e-mailem lub SMS-em 30 i 7 dni wcześniej, a po przeglądzie jednym kliknięciem potwierdzisz, że urządzenie
        działa.
      </p>
      {passport.keeperEmail ? (
        <button type="button" onClick={request} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark">
          Wyślij link na adres {passport.keeperEmail}
        </button>
      ) : (
        <p>W danych tego urządzenia nie ma adresu e-mail opiekuna. Napisz do operatora serwisu, a przygotuje dla Ciebie link.</p>
      )}
      <p aria-live="polite" className={`font-semibold ${state?.tone ?? ""}`}>
        {state?.text}
      </p>
      <p>
        <Link href={`/aed/${id}/naklejka`} className="text-gov underline">
          Wydrukuj naklejkę z kodem QR
        </Link>
      </p>
    </section>
  );
}
