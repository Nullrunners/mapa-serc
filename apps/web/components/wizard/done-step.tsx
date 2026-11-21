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
        {published
          ? "Dane są już widoczne na mapie, a przy najbliższej aktualizacji pojawią się też na portalu dane.gov.pl."
          : "Administrator zbioru musi je jeszcze zatwierdzić. Potem zobaczysz je na mapie i na portalu dane.gov.pl."}
      </p>
      {!published && (
        <p>
          {email
            ? `Po zatwierdzeniu wyślemy na adres ${email} naklejki z kodem QR i linki do paszportów urządzeń.`
            : "Naklejki z kodem QR i linki do paszportów urządzeń przekaże Ci administrator zbioru po zatwierdzeniu."}
        </p>
      )}
      <ul className="list-disc space-y-1 pl-6">
        <li>Nowe urządzenia: {result.added}</li>
        <li>Urządzenia, które już znaliśmy i połączyliśmy z Twoimi danymi: {result.merged}</li>
        {result.incomplete > 0 && <li>Do uzupełnienia (brakuje miejsca na mapie albo nazwy): {result.incomplete}</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <a href={result.files.csv} className="btn btn-primary">
          Pobierz uporządkowane dane (CSV)
        </a>
        <Link href="/jakosc" className="link">
          Zobacz, co sprawdziliśmy w Twoim pliku
        </Link>
      </div>
      <p className="hint">Uporządkowany plik możesz też wgrać na stronę swojej instytucji w dane.gov.pl.</p>

      {result.devices.length > 0 && (
        <section aria-labelledby="paszporty-naglowek" className="space-y-3 border-t border-line pt-5">
          <h3 id="paszporty-naglowek" className="text-lg font-bold">
            Paszporty Twoich urządzeń
          </h3>
          <p>
            Wydrukuj naklejki z kodem QR i przyklej je przy defibrylatorach. W panelu opiekuna wpiszesz terminy ważności elektrod i baterii, a my przypomnimy Ci o wymianie. Zachowaj te linki: każdy daje
            dostęp do zarządzania jednym urządzeniem.
            {email && ` Wysłaliśmy je też na adres ${email}.`}
          </p>
          {result.devices.length > 1 && (
            <p className="flex flex-wrap gap-x-4 gap-y-2">
              {stickerSheets(result.devices.map((device) => device.id)).map((sheet, _, sheets) => (
                <Link key={sheet.href} href={sheet.href} className="btn btn-secondary">
                  {sheets.length === 1 ? "Wydrukuj wszystkie naklejki na kartkach A4" : `Naklejki ${sheet.from}–${sheet.to} na kartkach A4`}
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
