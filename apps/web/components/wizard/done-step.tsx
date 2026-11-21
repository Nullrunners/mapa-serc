import Link from "next/link";
import type { Ref } from "react";
import { stickerSheets } from "@/lib/passport-text";
import { StepHeading, type Result } from "./shared";

/** What happened to the submission, the cleaned data, and the passports of the devices with their stickers. */
export default function DoneStep({ headingRef, result, email }: { headingRef: Ref<HTMLHeadingElement>; result: Result; email: string }) {
  const published = result.status === "published";
  return (
    <section className="max-w-3xl space-y-5">
      <StepHeading headingRef={headingRef}>{published ? "Dziękujemy, urządzenia są już w bazie" : "Dziękujemy, zgłoszenie przyjęte"}</StepHeading>
      <p>
        {published ? "Są już na mapie, wkrótce także na dane.gov.pl." : "Po zatwierdzeniu przez administratora pojawią się na mapie i na dane.gov.pl."}
        {!published && (email ? ` Naklejki QR i linki wyślemy wtedy na ${email}.` : " Naklejki QR i linki przekaże Ci wtedy administrator.")}
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Nowe: {result.added}</li>
        <li>Połączone ze znanymi: {result.merged}</li>
        {result.incomplete > 0 && <li>Do uzupełnienia (brak położenia lub nazwy): {result.incomplete}</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <a href={result.files.csv} className="btn btn-primary">
          Pobierz uporządkowane dane (CSV)
        </a>
        <Link href="/jakosc" className="link">
          Raport jakości
        </Link>
      </div>
      <p className="hint">Ten plik możesz też wgrać na dane.gov.pl.</p>

      {result.devices.length > 0 && (
        <section aria-labelledby="paszporty-naglowek" className="space-y-3 border-t border-line pt-5">
          <h3 id="paszporty-naglowek" className="text-lg font-bold">
            Paszporty Twoich urządzeń
          </h3>
          <p>
            Wydrukuj naklejki QR i przyklej je przy urządzeniach. Zachowaj linki do panelu: dają dostęp do zarządzania.
            {email && ` Wysłaliśmy je też na ${email}.`}
          </p>
          {result.devices.length > 1 && (
            <p className="flex flex-wrap gap-x-4 gap-y-2">
              {stickerSheets(result.devices.map((device) => device.id)).map((sheet, _, sheets) => (
                <Link key={sheet.href} href={sheet.href} className="btn btn-secondary">
                  {sheets.length === 1 ? "Drukuj wszystkie naklejki (A4)" : `Naklejki ${sheet.from}–${sheet.to} (A4)`}
                </Link>
              ))}
            </p>
          )}
          <ul className="divide-y divide-line border-y border-line text-sm">
            {result.devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span className="font-semibold">{device.name}</span>
                <span className="flex gap-4">
                  <a href={device.stickerUrl} className="link">
                    Naklejka
                  </a>
                  <a href={device.ownerUrl} className="link">
                    Panel opiekuna
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
