"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import DeviceList, { type Picked } from "@/components/device-list";
import { GuideIcon, Preview3dIcon } from "@/components/guide";
import { BackButton, ExternalLink, LoadStatus, Status } from "@/components/ui";
import { AVAILABILITY, STATUS_WARNING, access, addressLine, hours, spot, title } from "@/lib/aed-text";
import { api, type AedItem } from "@/lib/api/client";
import { date } from "@/lib/format";
import { scrollMotion } from "@/lib/motion";
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
  /** Starts leading the person to this device on our map; there only when the device is within a walk. */
  onGuide?: () => void;
  /** Opens the way to this device in 3D; there once the way is known. Focus goes back to `opener` afterwards. */
  onPreview?: (opener: HTMLElement) => void;
  /** Shown above the device while the person is led to it: what to do next on the way. */
  guidance?: ReactNode;
}

/** Everything we know about one device, plus the closest other devices in case this one cannot be reached. */
export default function AedDetails({ picked, layer, onlyAvailable, onPick, onClose, from = null, walkNote, onGuide, onPreview, guidance }: AedDetailsProps) {
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

  // Move focus (and the page, on a phone the panel sits above the map) to the device once it is there. While the
  // person is led to it the guidance above keeps the focus, and gives it back here when it ends.
  const ready = loaded.state === "ready";
  const guided = !!guidance;
  useEffect(() => {
    if (!ready || guided || !heading.current) return;
    heading.current.focus({ preventScroll: true });
    heading.current.scrollIntoView({ behavior: scrollMotion(), block: "nearest" });
  }, [ready, guided, picked.id]);

  return (
    <section aria-labelledby="urzadzenie-naglowek" className="space-y-5">
      <BackButton onClick={onClose}>Wróć do listy</BackButton>
      {guidance}
      <div aria-live="polite">
        <LoadStatus of={loaded} />
      </div>

      {loaded.state === "ready" && (
        <>
          <Device item={loaded.data.item} passport={loaded.data.passport} headingRef={heading} from={from} walkNote={walkNote} onGuide={onGuide} onPreview={onPreview} guided={guided} />

          <section aria-labelledby="najblizsze-naglowek" className="space-y-2 border-t border-line pt-5">
            <h3 id="najblizsze-naglowek" className="font-bold">
              Inne w pobliżu
            </h3>
            {loaded.data.nearby === null && <p className="text-sm text-danger">Nie udało się wczytać urządzeń w pobliżu.</p>}
            {loaded.data.nearby?.length === 0 && <p className="hint">Brak innych w pobliżu.</p>}
            {!!loaded.data.nearby?.length && <DeviceList items={loaded.data.nearby} compact onPick={onPick} />}
          </section>
        </>
      )}
    </section>
  );
}

interface DeviceProps {
  item: AedItem;
  passport: PassportPublic | null;
  headingRef: Ref<HTMLHeadingElement>;
  from: Point | null;
  walkNote: ReactNode;
  onGuide?: () => void;
  onPreview?: (opener: HTMLElement) => void;
  /** The person is being led here on our map, so Google Maps is only the other way to go. */
  guided: boolean;
}

function Device({ item, passport, headingRef, from, walkNote, onGuide, onPreview, guided }: DeviceProps) {
  const { record } = item;
  const warning = STATUS_WARNING[record.status];
  const availability = AVAILABILITY.now[item.availableNow];

  const rows: [string, ReactNode][] = [
    ["Gdzie", spot(record) || null],
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
    ["Sprawdzony", record.data_weryfikacji && !passport?.confirmedByKeeper ? date(record.data_weryfikacji) : null],
    ["Źródło", record.zrodlo],
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
        {onGuide && (
          <button type="button" onClick={onGuide} className="btn btn-primary">
            <GuideIcon />
            Prowadź mnie
          </button>
        )}
        {onPreview && (
          <button type="button" onClick={(event) => onPreview(event.currentTarget)} className="btn btn-secondary">
            <Preview3dIcon />
            Zobacz trasę w 3D
          </button>
        )}
        <ExternalLink href={googleDirections(from, { lat: record.szerokosc_geograficzna, lon: record.dlugosc_geograficzna })} className={onGuide || guided ? "btn btn-secondary" : "btn btn-primary"}>
          Trasa w Mapach Google
        </ExternalLink>
        <Link href={`/aed/${item.id}`} className="btn btn-secondary">
          Raport urządzenia
        </Link>
      </div>
      <p className="hint">W raporcie zgłosisz problem albo wydrukujesz naklejkę QR.</p>
    </article>
  );
}
