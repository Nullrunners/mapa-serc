"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { api, type AedItem } from "@/lib/api/client";
import { ACCESS_LABEL, AVAILABLE_NOW, STATUS_WARNING, addressLine, date, distance, hours, title } from "@/lib/aed-text";
import { useLoad } from "@/lib/use-load";

/** A device picked on the map or in a list. The position comes with it, so the map can fly there before the details arrive. */
export interface Picked {
  id: string;
  lat: number;
  lon: number;
}

const NEARBY = 5;

export const pickedFrom = (item: AedItem): Picked => ({ id: item.id, lat: item.record.szerokosc_geograficzna, lon: item.record.dlugosc_geograficzna });

export interface AedDetailsProps {
  picked: Picked;
  layer: "all" | "official";
  onlyAvailable: boolean;
  onPick: (picked: Picked) => void;
  onClose: () => void;
}

/** Everything we know about one device, plus the closest other devices in case this one cannot be reached. */
export default function AedDetails({ picked, layer, onlyAvailable, onPick, onClose }: AedDetailsProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  const loaded = useLoad(`${picked.id}|${layer}|${onlyAvailable}`, async (signal) => {
    const [one, near] = await Promise.all([
      api.GET("/v1/aed/{id}", { params: { path: { id: picked.id } }, signal }),
      api.GET("/v1/aed", {
        params: { query: { layer, near: `${picked.lat},${picked.lon}`, availableNow: onlyAvailable ? "true" : undefined, limit: NEARBY + 1 } },
        signal,
      }),
    ]);
    if (one.error || !one.data) throw new Error("Nie udało się wczytać informacji o tym urządzeniu. Spróbuj ponownie za chwilę.");
    // The nearby list is a help, not the point: when it fails, the device itself is still shown.
    const nearby = near.data ? near.data.items.filter((item) => item.id !== picked.id).slice(0, NEARBY) : null;
    return { item: one.data, nearby };
  });

  // Move focus (and the page, on a phone the panel sits above the map) to the device once it is there.
  const ready = loaded.state === "ready";
  useEffect(() => {
    if (!ready || !heading.current) return;
    heading.current.focus({ preventScroll: true });
    heading.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [ready, picked.id]);

  return (
    <section aria-labelledby="urzadzenie-naglowek" className="space-y-4">
      <button type="button" onClick={onClose} className="text-sm font-semibold text-gov underline">
        ← Wróć do listy
      </button>

      <div aria-live="polite">
        {loaded.state === "loading" && <p className="text-muted">Wczytuję…</p>}
        {loaded.state === "error" && (
          <p role="alert" className="text-danger">
            {loaded.message}
          </p>
        )}
        {loaded.state === "ready" && <Device item={loaded.data.item} headingRef={heading} />}
      </div>

      {loaded.state === "ready" && (
        <section aria-labelledby="najblizsze-naglowek" className="space-y-2">
          <h3 id="najblizsze-naglowek" className="font-bold">
            Najbliższe inne defibrylatory
          </h3>
          {loaded.data.nearby === null && <p className="text-sm text-danger">Nie udało się wczytać urządzeń w pobliżu.</p>}
          {loaded.data.nearby?.length === 0 && <p className="text-sm text-muted">W pobliżu nie ma innych urządzeń, które pasują do wybranych filtrów.</p>}
          {!!loaded.data.nearby?.length && (
            <ol className="divide-y divide-line border-y border-line">
              {loaded.data.nearby.map((item) => (
                <li key={item.id} className="space-y-0.5 px-1 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <button type="button" onClick={() => onPick(pickedFrom(item))} className="text-left font-semibold text-gov underline-offset-2 hover:underline">
                      {title(item)}
                    </button>
                    {item.distanceM !== null && <span className="shrink-0 text-sm font-semibold">{distance(item.distanceM)} stąd</span>}
                  </div>
                  {addressLine(item) && <p className="text-sm">{addressLine(item)}</p>}
                  <p className={`text-sm ${AVAILABLE_NOW[item.availableNow].tone}`}>{AVAILABLE_NOW[item.availableNow].label}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </section>
  );
}

function Device({ item, headingRef }: { item: AedItem; headingRef: Ref<HTMLHeadingElement> }) {
  const { record } = item;
  const where = [
    record.opis_lokalizacji,
    record.wewnatrz_budynku === true ? "w budynku" : record.wewnatrz_budynku === false ? "na zewnątrz budynku" : null,
    record.pietro ? `piętro: ${record.pietro}` : null,
  ].filter(Boolean);
  const access = [record.dostep ? ACCESS_LABEL[record.dostep] : null, record.uwagi_dostepu].filter(Boolean);
  const warning = STATUS_WARNING[record.status];

  const rows: [string, ReactNode][] = [
    ["Adres", addressLine(item)],
    ["Gdzie dokładnie", where.length ? where.join(", ") : null],
    ["Godziny", record.godziny_dostepnosci ? hours(record.godziny_dostepnosci) : null],
    ["Dostęp", access.length ? access.join(". ") : null],
    ["Elektrody dla dzieci", record.elektrody_pediatryczne === null ? null : record.elektrody_pediatryczne ? "tak" : "nie"],
    ["Opiekun", record.podmiot_odpowiedzialny],
    ["Telefon", record.telefon_kontaktowy ? <a href={`tel:${record.telefon_kontaktowy.replace(/\s/g, "")}`} className="text-gov underline">{record.telefon_kontaktowy}</a> : null],
    ["Ostatnio sprawdzony", record.data_weryfikacji ? date(record.data_weryfikacji) : null],
    ["Skąd te dane", record.zrodlo],
  ];

  return (
    <article className="space-y-3 rounded border border-line p-4">
      <h2 id="urzadzenie-naglowek" ref={headingRef} tabIndex={-1} className="text-lg font-bold">
        {title(item)}
      </h2>
      {warning && <p className="font-semibold text-danger">{warning}</p>}
      {item.publication === "community" && (
        <p className="text-sm font-semibold text-warn">To urządzenie nie zostało jeszcze potwierdzone. Pochodzi z OpenStreetMap, więc informacje mogą być nieaktualne.</p>
      )}
      <p className={`font-semibold ${AVAILABLE_NOW[item.availableNow].tone}`}>{AVAILABLE_NOW[item.availableNow].label}</p>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${record.szerokosc_geograficzna},${record.dlugosc_geograficzna}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark"
      >
        Pokaż drogę w Mapach Google<span className="sr-only"> (otworzy się w nowej karcie)</span>
      </a>
    </article>
  );
}
