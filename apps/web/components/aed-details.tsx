"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import DeviceList, { type Picked } from "@/components/device-list";
import { BackButton, ExternalLink, LoadStatus, Status } from "@/components/ui";
import { AVAILABILITY, STATUS_WARNING, access, addressLine, hours, spot, title } from "@/lib/aed-text";
import { api, type AedItem } from "@/lib/api/client";
import { date } from "@/lib/format";
import type { PassportPublic } from "@/lib/passport-text";
import { googleDirections, type Point } from "@/lib/route";
import { useLoad } from "@/lib/use-load";
import PassportNote from "./passport-note";

const NEARBY = 5;

export interface AedDetailsProps {
  picked: Picked;
  layer: "all" | "official";
  onlyAvailable: boolean;
  onPick: (picked: Picked) => void;
  onClose: () => void;
  /** The person's position, when they shared it: the directions start there. */
  from?: Point | null;
  /** How far the walk to this device is, shown above the directions button. */
  walkNote?: ReactNode;
}

/** Everything we know about one device, plus the closest other devices in case this one cannot be reached. */
export default function AedDetails({ picked, layer, onlyAvailable, onPick, onClose, from = null, walkNote }: AedDetailsProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  const loaded = useLoad(`${picked.id}|${layer}|${onlyAvailable}`, async (signal) => {
    const [one, near, card] = await Promise.all([
      api.GET("/v1/aed/{id}", { params: { path: { id: picked.id } }, signal }),
      api.GET("/v1/aed", {
        params: { query: { layer, near: `${picked.lat},${picked.lon}`, availableNow: onlyAvailable ? "true" : undefined, limit: NEARBY + 1 } },
        signal,
      }),
      api.GET("/v1/aed/{id}/passport", { params: { path: { id: picked.id } }, signal }),
    ]);
    if (one.error || !one.data) throw new Error("Nie udało się wczytać informacji o tym urządzeniu. Spróbuj ponownie za chwilę.");
    // The nearby list and the passport are a help, not the point: when they fail, the device itself is still shown.
    const nearby = near.data ? near.data.items.filter((item) => item.id !== picked.id).slice(0, NEARBY) : null;
    return { item: one.data, nearby, passport: card.data ?? null };
  });

  // Move focus (and the page, on a phone the panel sits above the map) to the device once it is there.
  const ready = loaded.state === "ready";
  useEffect(() => {
    if (!ready || !heading.current) return;
    heading.current.focus({ preventScroll: true });
    heading.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [ready, picked.id]);

  return (
    <section aria-labelledby="urzadzenie-naglowek" className="space-y-5">
      <BackButton onClick={onClose}>Wróć do listy</BackButton>
      <div aria-live="polite">
        <LoadStatus of={loaded} />
      </div>

      {loaded.state === "ready" && (
        <>
          <Device item={loaded.data.item} passport={loaded.data.passport} headingRef={heading} from={from} walkNote={walkNote} />

          <section aria-labelledby="najblizsze-naglowek" className="space-y-2 border-t border-line pt-5">
            <h3 id="najblizsze-naglowek" className="font-bold">
              Najbliższe inne defibrylatory
            </h3>
            {loaded.data.nearby === null && <p className="text-sm text-danger">Nie udało się wczytać urządzeń w pobliżu.</p>}
            {loaded.data.nearby?.length === 0 && <p className="hint">W pobliżu nie ma innych urządzeń, które pasują do wybranych filtrów.</p>}
            {!!loaded.data.nearby?.length && <DeviceList items={loaded.data.nearby} compact onPick={onPick} />}
          </section>
        </>
      )}
    </section>
  );
}

function Device({ item, passport, headingRef, from, walkNote }: { item: AedItem; passport: PassportPublic | null; headingRef: Ref<HTMLHeadingElement>; from: Point | null; walkNote: ReactNode }) {
  const { record } = item;
  const warning = STATUS_WARNING[record.status];
  const availability = AVAILABILITY.now[item.availableNow];

  const rows: [string, ReactNode][] = [
    ["Gdzie dokładnie", spot(record) || null],
    ["Godziny", record.godziny_dostepnosci ? hours(record.godziny_dostepnosci) : null],
    ["Dostęp", access(record) || null],
    ["Elektrody dla dzieci", record.elektrody_pediatryczne === null ? null : record.elektrody_pediatryczne ? "tak" : "nie"],
    ["Opiekun", record.podmiot_odpowiedzialny],
    [
      "Telefon",
      record.telefon_kontaktowy ? (
        <a href={`tel:${record.telefon_kontaktowy.replace(/\s/g, "")}`} className="link">
          {record.telefon_kontaktowy}
        </a>
      ) : null,
    ],
    // After the keeper's confirmation this is the same date as in the passport note above; say it once.
    ["Ostatnio sprawdzony", record.data_weryfikacji && !passport?.confirmedByKeeper ? date(record.data_weryfikacji) : null],
    ["Skąd te dane", record.zrodlo],
  ];

  return (
    <article className="space-y-4">
      <div className="space-y-1">
        <h2 id="urzadzenie-naglowek" ref={headingRef} tabIndex={-1} className="text-xl leading-snug font-bold text-balance">
          {title(item)}
        </h2>
        {addressLine(item) && <p>{addressLine(item)}</p>}
      </div>

      <div className="space-y-1.5">
        {warning && <p className="font-semibold text-danger">{warning}</p>}
        <Status tone={availability.tone}>{availability.label}</Status>
        <PassportNote publication={item.publication} passport={passport} />
      </div>

      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      {walkNote}
      <div className="flex flex-wrap gap-2">
        <ExternalLink href={googleDirections(from, { lat: record.szerokosc_geograficzna, lon: record.dlugosc_geograficzna })} className="btn btn-primary">
          Pokaż drogę w Mapach Google
        </ExternalLink>
        <Link href={`/aed/${item.id}`} className="btn btn-secondary">
          Paszport urządzenia
        </Link>
      </div>
      <p className="hint">W paszporcie potwierdzisz, że urządzenie jest na miejscu, zgłosisz problem albo wydrukujesz naklejkę z kodem QR.</p>
    </article>
  );
}
