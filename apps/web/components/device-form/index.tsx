"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MapPlaceholder } from "@/components/map-frame";
import { Status } from "@/components/ui";
import { title } from "@/lib/aed-text";
import { api, problemMessage, type AedItem } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { distance } from "@/lib/format";
import type { Point } from "@/lib/route";
import { useLoad } from "@/lib/use-load";
import PlaceSearch from "./place-search";

// MapLibre needs a browser; the form around it works before the map has loaded.
const PinMap = dynamic(() => import("./pin-map"), { ssr: false, loading: () => <MapPlaceholder /> });

type Report = components["schemas"]["DeviceReport"];
type Access = NonNullable<Report["record"]["dostep"]>;

const ACCESS_CHOICES: [Access | "", string][] = [
  ["publiczny", "Każdy"],
  ["ograniczony", "Klienci i goście"],
  ["prywatny", "Tylko pracownicy"],
  ["", "Nie wiem"],
];
const HOURS_CHOICES = [
  ["24/7", "Całą dobę"],
  ["inne", "W określonych godzinach"],
  ["", "Nie wiem"],
] as const;
const INDOOR_CHOICES = [
  ["tak", "W budynku"],
  ["nie", "Na zewnątrz"],
  ["", "Nie wiem"],
] as const;

/** A known device this close to the pin is most likely the same one. */
const SAME_PLACE_M = 50;

const rounded = (point: Point): Point => ({ lat: Number(point.lat.toFixed(5)), lon: Number(point.lon.toFixed(5)) });

/** What lies around the pin: the nearest address and the devices already known there. */
function useSurroundings(point: Point | null) {
  // Asked once the pin has rested a moment, not at every step of a drag.
  const [settled, setSettled] = useState<Point | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(point), 600);
    return () => clearTimeout(timer);
  }, [point]);

  return useLoad(settled ? `okolica|${settled.lat},${settled.lon}` : "okolica|", async (signal) => {
    if (!settled) return { address: null, nearby: [] as AedItem[] };
    const [address, nearby] = await Promise.all([
      api.GET("/v1/geo/nearest", { params: { query: { at: `${settled.lon},${settled.lat}` } }, signal }).then(
        ({ data }) => data?.address?.label ?? null,
        () => null,
      ),
      api.GET("/v1/aed", { params: { query: { near: `${settled.lat},${settled.lon}`, layer: "all", radiusM: SAME_PLACE_M, limit: 3 } }, signal }).then(
        ({ data }) => data?.items ?? [],
        () => [],
      ),
    ]);
    return { address, nearby };
  });
}

/** One defibrillator: where it is on the map, a few words about it, and who may hear from us once it is checked. */
export default function DeviceForm({ initial }: { initial: Point | null }) {
  const [target, setTarget] = useState<Point | null>(initial);
  const [point, setPoint] = useState<Point | null>(null);
  const surroundings = useSurroundings(point);

  const [name, setName] = useState("");
  const [spot, setSpot] = useState("");
  const [access, setAccess] = useState<Access | "">("");
  const [hours, setHours] = useState<(typeof HOURS_CHOICES)[number][0]>("");
  const [hoursText, setHoursText] = useState("");
  const [indoor, setIndoor] = useState<(typeof INDOOR_CHOICES)[number][0]>("");
  const [keeper, setKeeper] = useState(false);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string | null } | null>(null);

  const placeHeading = useRef<HTMLHeadingElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (sent) doneHeading.current?.focus();
  }, [sent]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!point) {
      setError("Ustaw pinezkę na defibrylatorze: przybliż mapę albo wpisz adres.");
      placeHeading.current?.focus();
      return;
    }
    const keeperEmail = keeper ? email.trim() : "";
    const body: Report = {
      record: {
        nazwa: name.trim(),
        szerokosc_geograficzna: point.lat,
        dlugosc_geograficzna: point.lon,
        ...(spot.trim() ? { opis_lokalizacji: spot.trim() } : {}),
        ...(access ? { dostep: access } : {}),
        ...(hours === "24/7" ? { godziny_dostepnosci: "24/7" } : hours === "inne" && hoursText.trim() ? { godziny_dostepnosci: hoursText.trim() } : {}),
        ...(indoor ? { wewnatrz_budynku: indoor === "tak" } : {}),
      },
      ...(keeperEmail ? { keeperEmail } : {}),
      consent: true,
    };
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api.POST("/v1/import/device", { body }).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) return setError(problemMessage(problem, "Nie udało się wysłać zgłoszenia. Spróbuj za chwilę."));
    setSent({ email: keeperEmail || null });
  }

  function another() {
    setName("");
    setSpot("");
    setAccess("");
    setHours("");
    setHoursText("");
    setIndoor("");
    setConsent(false);
    setSent(null);
  }

  if (sent) {
    return (
      <section className="max-w-2xl space-y-4">
        <h2 ref={doneHeading} tabIndex={-1} className="text-xl font-bold">
          Dziękujemy!
        </h2>
        <p>
          Sprawdzimy zgłoszenie i dodamy defibrylator do mapy.
          {sent.email && ` Jeśli wszystko się zgadza, wyślemy na ${sent.email} naklejkę QR i link do panelu opiekuna.`}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={another} className="btn btn-primary">
            Zgłoś kolejny
          </button>
          <Link href="/" className="btn btn-secondary">
            Wróć do mapy
          </Link>
        </div>
      </section>
    );
  }

  const near = point && surroundings.state === "ready" ? surroundings.data : null;
  const same = near?.nearby[0];

  return (
    <div className="max-w-3xl space-y-8">
      <section aria-labelledby="gdzie" className="space-y-4">
        <h2 id="gdzie" ref={placeHeading} tabIndex={-1} className="text-xl font-bold">
          1. Gdzie jest defibrylator?
        </h2>
        <PlaceSearch onFound={(found) => setTarget(rounded(found))} />
        <div className="relative h-72 overflow-hidden rounded-lg border border-line sm:h-96">
          <PinMap target={target} onMove={setPoint} />
        </div>
        <div aria-live="polite" className="space-y-2 text-sm">
          {!point && <p className="text-muted">Przybliż mapę i ustaw pinezkę na defibrylatorze.</p>}
          {point && <p>{near?.address ? `Najbliższy adres: ${near.address}` : "Pinezka ustawiona."}</p>}
          {same && (
            <Status tone="warn">
              Obok jest już defibrylator: {title(same)}
              {same.distanceM !== null && ` (${distance(same.distanceM)})`}. Jeśli to ten sam, nie musisz go zgłaszać.{" "}
              <Link href={`/aed/${same.id}`} className="link">
                Zobacz go
              </Link>
            </Status>
          )}
        </div>
      </section>

      <form onSubmit={submit} className="space-y-6">
        <h2 className="text-xl font-bold">2. Opisz go</h2>

        <div className="space-y-1.5">
          <label htmlFor="nazwa" className="label">
            Nazwa miejsca
          </label>
          <input id="nazwa" required minLength={2} maxLength={200} placeholder="np. Apteka Pod Lipami" value={name} onChange={(event) => setName(event.target.value)} className="field w-full" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="gdzie-dokladnie" className="label">
            Gdzie dokładnie <span className="font-normal text-muted">(nieobowiązkowe)</span>
          </label>
          <p id="gdzie-dokladnie-opis" className="hint">
            Np. „przy wejściu, obok kas”. Bez kodu do szafki.
          </p>
          <input id="gdzie-dokladnie" maxLength={300} aria-describedby="gdzie-dokladnie-opis" value={spot} onChange={(event) => setSpot(event.target.value)} className="field w-full" />
        </div>

        <Choices legend="W budynku czy na zewnątrz?" name="budynek" choices={INDOOR_CHOICES} value={indoor} onChange={setIndoor} />
        <Choices legend="Kto może z niego skorzystać?" name="dostep" choices={ACCESS_CHOICES} value={access} onChange={setAccess} />
        <Choices legend="Kiedy jest dostępny?" name="godziny" choices={HOURS_CHOICES} value={hours} onChange={setHours}>
          {hours === "inne" && (
            <div className="space-y-1">
              <label htmlFor="godziny-tekst" className="label text-sm">
                Godziny
              </label>
              <input
                id="godziny-tekst"
                required
                maxLength={200}
                placeholder="np. pn-pt 8-16, sob 9-13"
                value={hoursText}
                onChange={(event) => setHoursText(event.target.value)}
                className="field w-full max-w-sm"
              />
            </div>
          )}
        </Choices>

        <div className="space-y-3">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={keeper} onChange={(event) => setKeeper(event.target.checked)} className="mt-1 size-4" />
            <span>Opiekuję się tym defibrylatorem</span>
          </label>
          {keeper && (
            <div className="space-y-1.5 pl-7">
              <label htmlFor="email" className="label">
                Twój e-mail
              </label>
              <p id="email-opis" className="hint">
                Po sprawdzeniu wyślemy naklejkę QR i link do panelu. Nie publikujemy go.
              </p>
              <input id="email" type="email" required maxLength={120} autoComplete="email" aria-describedby="email-opis" value={email} onChange={(event) => setEmail(event.target.value)} className="field w-full max-w-sm" />
            </div>
          )}
        </div>

        <label className="flex items-start gap-3">
          <input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 size-4" />
          <span>Udostępniam ten opis jako otwarte dane (CC0). Nie ma w nim danych osobowych.</span>
        </label>

        {error && (
          <p role="alert" className="rounded-lg border border-l-4 border-line border-l-danger p-3 text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Wysyłam…" : "Wyślij zgłoszenie"}
        </button>
      </form>
    </div>
  );
}

/** One question answered with a row of pills; "Nie wiem" is a choice, so nothing is asked twice. */
function Choices<T extends string>({
  legend,
  name,
  choices,
  value,
  onChange,
  children,
}: {
  legend: string;
  name: string;
  choices: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  children?: ReactNode;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map(([choice, label]) => (
          <label key={label} className="chip">
            <input type="radio" name={name} value={choice} checked={value === choice} onChange={() => onChange(choice)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  );
}
