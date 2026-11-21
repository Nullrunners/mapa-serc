"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, LiveMessage, LoadStatus, Status, TONE_TEXT, type Message } from "@/components/ui";
import { AVAILABILITY, STATUS_WARNING, access, addressLine, hours, spot, title } from "@/lib/aed-text";
import { api, problemMessage, type AedItem } from "@/lib/api/client";
import { date, dateTime } from "@/lib/format";
import { PROBLEMS, REPORT_BUTTON, REPORT_TEXT, expiryText, partName, reportedBy, type PassportPublic, type ReportKind } from "@/lib/passport-text";
import { googleDirections } from "@/lib/route";
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
    <div className="mx-auto max-w-xl space-y-6">
      <p className="rounded-lg border-2 border-danger p-4 font-semibold">
        Ktoś stracił przytomność? Dzwoń{" "}
        <a href="tel:112" className="text-danger underline">
          112
        </a>
        . Włącz defibrylator i rób to, co mówi.
      </p>
      <div aria-live="polite">
        <LoadStatus of={loaded} />
      </div>
      {loaded.state === "ready" && <Card item={loaded.data.item} passport={passport ?? loaded.data.passport} onPassport={setPassport} />}
    </div>
  );
}

function Card({ item, passport, onPassport }: { item: AedItem; passport: PassportPublic; onPassport: (passport: PassportPublic) => void }) {
  const { record } = item;
  const warning = STATUS_WARNING[record.status];
  const availability = AVAILABILITY.now[item.availableNow];
  const where = spot(record);
  const how = access(record);

  return (
    <>
      <section aria-labelledby="paszport-naglowek" className="space-y-2">
        <p className="text-sm font-semibold tracking-wide text-gov uppercase">Paszport defibrylatora</p>
        <h1 id="paszport-naglowek" className="text-2xl font-bold text-balance">
          {title(item)}
        </h1>
        {addressLine(item) && <p>{addressLine(item)}</p>}
        {where && <p className="text-sm text-muted">{where}</p>}
        <div className="space-y-1 pt-1">
          {warning && <p className="font-semibold text-danger">{warning}</p>}
          <Status tone={availability.tone}>{availability.label}</Status>
          {record.godziny_dostepnosci && <p className="text-sm">Godziny: {hours(record.godziny_dostepnosci)}</p>}
          {how && <p className="text-sm">Dostęp: {how}</p>}
        </div>
      </section>

      <Report id={item.id} onPassport={onPassport} />

      <section aria-labelledby="stan-naglowek" className="card space-y-2">
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
          {passport.items
            .filter((entry) => entry.date)
            .map((entry) => {
              const expiry = expiryText(entry);
              return (
                <li key={entry.item}>
                  {partName(entry)}: <span className={`font-semibold ${TONE_TEXT[expiry.tone]}`}>{expiry.text}</span>
                </li>
              );
            })}
        </ul>
        {item.publication === "community" && <p className="text-sm text-warn">Dane tego urządzenia pochodzą z OpenStreetMap i nikt z instytucji ich jeszcze nie potwierdził.</p>}
      </section>

      <ExternalLink href={googleDirections(null, { lat: record.szerokosc_geograficzna, lon: record.dlugosc_geograficzna })} className="link inline-block font-semibold">
        Pokaż drogę w Mapach Google
      </ExternalLink>

      <Keeper id={item.id} passport={passport} />
    </>
  );
}

function Report({ id, onPassport }: { id: string; onPassport: (passport: PassportPublic) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function send(kind: ReportKind) {
    setBusy(true);
    setMessage(null);
    const { data } = await api.POST("/v1/aed/{id}/reports", { params: { path: { id } }, body: { kind } }).catch(() => ({ data: undefined }));
    setBusy(false);
    setOpen(false);
    if (!data) return setMessage({ text: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.", tone: "danger" });
    onPassport(data.passport);
    if (data.outcome === "duplicate") return setMessage({ text: "Twoje zgłoszenie z ostatniej godziny już mamy. Dziękujemy!", tone: "ok" });
    if (data.outcome === "limit") return setMessage({ text: "Na dziś przyjęliśmy już wiele zgłoszeń o tym urządzeniu albo od Ciebie. Spróbuj jutro.", tone: "warn" });
    setMessage(
      kind === "ok"
        ? { text: "Dziękujemy! Dzięki Tobie wiadomo, że ten defibrylator jest gotowy do użycia.", tone: "ok" }
        : { text: "Dziękujemy! Przekazaliśmy zgłoszenie opiekunowi urządzenia.", tone: "ok" },
    );
  }

  return (
    <section aria-labelledby="zglos-naglowek" className="space-y-3">
      <h2 id="zglos-naglowek" className="font-bold">
        Przechodzisz obok? Daj znać, w jakim stanie jest urządzenie
      </h2>
      <button type="button" disabled={busy} onClick={() => send("ok")} className="btn btn-ok btn-lg w-full">
        <span>
          <span aria-hidden>✓ </span>
          {REPORT_BUTTON.ok}
        </span>
      </button>
      <button type="button" disabled={busy} aria-expanded={open} aria-controls="problemy" onClick={() => setOpen(!open)} className="btn btn-danger w-full py-3">
        Zgłoś problem
      </button>
      {open && (
        <ul id="problemy" className="space-y-2">
          {PROBLEMS.map((kind) => (
            <li key={kind}>
              <button type="button" disabled={busy} onClick={() => send(kind)} className="btn w-full justify-start border-line py-3 text-left hover:bg-surface">
                {REPORT_BUTTON[kind]}
              </button>
            </li>
          ))}
        </ul>
      )}
      <LiveMessage message={message} />
    </section>
  );
}

function Keeper({ id, passport }: { id: string; passport: PassportPublic }) {
  const [message, setMessage] = useState<Message | null>(null);

  async function request() {
    const { data, error } = await api.POST("/v1/aed/{id}/passport/link", { params: { path: { id } } }).catch(() => ({ data: undefined, error: undefined }));
    setMessage(data ? { text: `Wysłaliśmy link na adres ${data.sentTo}. Sprawdź skrzynkę.`, tone: "ok" } : { text: problemMessage(error, "Nie udało się wysłać linku. Spróbuj ponownie za chwilę."), tone: "danger" });
  }

  return (
    <section aria-labelledby="opiekun-naglowek" className="space-y-3 border-t border-line pt-5 text-sm">
      <h2 id="opiekun-naglowek" className="text-base font-bold">
        Opiekujesz się tym defibrylatorem?
      </h2>
      <p>
        W paszporcie wpiszesz terminy ważności elektrod i baterii. Przypomnimy Ci o wymianie e-mailem lub SMS-em 30 i 7 dni wcześniej, a po przeglądzie jednym kliknięciem potwierdzisz, że urządzenie
        działa.
      </p>
      {passport.keeperEmail ? (
        <button type="button" onClick={request} className="btn btn-secondary">
          Wyślij link na adres {passport.keeperEmail}
        </button>
      ) : (
        <p>W danych tego urządzenia nie ma adresu e-mail opiekuna. Napisz do operatora serwisu, a przygotuje dla Ciebie link.</p>
      )}
      <LiveMessage message={message} />
      <p>
        <Link href={`/aed/${id}/naklejka`} className="link">
          Wydrukuj naklejkę z kodem QR
        </Link>
      </p>
    </section>
  );
}
