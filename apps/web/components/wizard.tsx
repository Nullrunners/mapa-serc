"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FIELDS, GROUPS, type FieldDef } from "@aed/schema";
import { api, API_URL } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Preview = components["schemas"]["ImportPreview"];
type Result = components["schemas"]["ImportResult"];
type Mapping = Record<string, string | null>;

const STEPS = ["Wybierz plik", "Sprawdź kolumny", "Zobacz poprawki", "Podpisz zgłoszenie", "Gotowe"] as const;

/** Fields the system fills in itself. */
const SYSTEM = new Set(["id", "zrodlo", "licencja", "data_aktualizacji"]);
const COMPOSITES = [
  { value: "adres", label: "Pełny adres w jednej kolumnie" },
  { value: "ulica", label: "Ulica razem z numerem" },
  { value: "wspolrzedne", label: "Obie współrzędne w jednej kolumnie" },
];
const TARGET_GROUPS = [
  ...GROUPS.map((group) => ({
    title: group.title,
    options: (FIELDS as readonly FieldDef[]).filter((field) => field.group === group.id && !SYSTEM.has(field.name)).map((field) => ({ value: field.name, label: field.title })),
  })).filter((group) => group.options.length > 0),
  { title: "Kolumny złożone", options: COMPOSITES },
];

/** File → base64 without building one enormous string of char codes at once. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

const problemText = (error: unknown, fallback: string) => {
  const problem = error as { detail?: string | null; issues?: { message: string }[] } | undefined;
  return [problem?.detail, ...(problem?.issues ?? []).map((issue) => issue.message)].filter(Boolean).join(" ") || fallback;
};

const cell = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

export default function Wizard() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [provider, setProvider] = useState({ name: "", email: "", licence: "CC0 1.0" as "CC0 1.0" | "CC BY 4.0", confirmed: false });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Token from an operator's invitation link (/dostawca?zaproszenie=…); such a submission is published at once.
  const [invitation, setInvitation] = useState<string | null>(null);

  // Each step starts at its heading, so a screen reader announces where the user is.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  async function loadPreview(source: { name: string; base64: string }, chosen?: Mapping): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api.POST("/v1/import/preview", { body: { fileName: source.name, contentBase64: source.base64, ...(chosen ? { mapping: chosen } : {}) } }).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(problemText(problem, "Nie udało się sprawdzić pliku. Spróbuj ponownie za chwilę."));
      return false;
    }
    setPreview(data);
    setMapping(Object.fromEntries(data.columns.map((column) => [column.header, column.target])));
    return true;
  }

  async function chooseFile(chosen: File | undefined) {
    if (!chosen) return;
    setInvitation(new URLSearchParams(window.location.search).get("zaproszenie"));
    const source = { name: chosen.name, base64: await toBase64(chosen) };
    setFile(source);
    if (await loadPreview(source)) setStep(2);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api
      .POST("/v1/import/commit", {
        body: {
          fileName: file.name,
          contentBase64: file.base64,
          mapping,
          provider: { name: provider.name.trim(), licence: provider.licence, ...(provider.email.trim() ? { email: provider.email.trim() } : {}) },
          ...(invitation ? { invitation } : {}),
        },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) return setError(problemText(problem, "Nie udało się zapisać zgłoszenia. Spróbuj ponownie za chwilę."));
    setResult(data);
    setStep(5);
  }

  const hasName = Object.values(mapping).includes("nazwa");
  const hasPosition = ["szerokosc_geograficzna", "wspolrzedne", "adres", "ulica", "nazwa_ulicy"].some((target) => Object.values(mapping).includes(target));

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-x-2 gap-y-2 text-sm" aria-label="Kroki zgłoszenia">
        {STEPS.map((title, index) => {
          const number = index + 1;
          const state = number === step ? "current" : number < step ? "done" : "todo";
          return (
            <li key={title} aria-current={state === "current" ? "step" : undefined} className={`flex items-center gap-2 rounded-full border px-3 py-1 ${state === "current" ? "border-gov bg-gov font-semibold text-white" : state === "done" ? "border-gov text-gov" : "border-line text-muted"}`}>
              <span aria-hidden>{state === "done" ? "✓" : number}</span>
              <span>
                <span className="sr-only">
                  Krok {number} z {STEPS.length}
                  {state === "done" ? ", zakończony" : ""}:{" "}
                </span>
                {title}
              </span>
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="rounded border-2 border-danger p-3 text-danger">
          {error}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {busy ? "Trwa przetwarzanie pliku." : ""}
      </p>

      {step === 1 && (
        <section className="max-w-3xl space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">
            Wybierz plik z listą defibrylatorów
          </h2>
          <p>
            Wystarczy plik, który już masz, w dowolnym układzie kolumn. Nie musisz go przerabiać: sami zgadniemy, co jest czym, a Ty tylko to potwierdzisz. Arkusz z Excela (.xlsx) możesz wgrać od razu,
            bez zapisywania go w innym formacie.
          </p>
          <div>
            <label htmlFor="plik" className="block font-semibold">
              Plik z urządzeniami
            </label>
            <p id="plik-opis" className="text-sm text-muted">
              Excel (.xlsx), CSV lub GeoJSON, do 5 MB.
            </p>
            <input id="plik" type="file" accept=".xlsx,.csv,.txt,.json,.geojson,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json,application/geo+json" aria-describedby="plik-opis" disabled={busy} onChange={(event) => chooseFile(event.target.files?.[0])} className="mt-2 block w-full rounded border border-muted p-2 file:mr-3 file:rounded file:border-0 file:bg-gov file:px-4 file:py-2 file:font-semibold file:text-white" />
          </div>
          {busy && <p className="text-muted">Sprawdzam plik…</p>}
          <p className="text-sm">
            Nie masz jeszcze listy?{" "}
            <a href={`${API_URL}/dane/wzorzec.xlsx`} className="text-gov underline">
              Pobierz szablon w Excelu
            </a>{" "}
            (wypełnij arkusz „Szablon”),{" "}
            <a href={`${API_URL}/dane/szablon.csv`} className="text-gov underline">
              szablon CSV
            </a>{" "}
            albo zobacz{" "}
            <Link href="/wzorzec" className="text-gov underline">
              opis wszystkich pól
            </Link>
            .
          </p>
        </section>
      )}

      {step === 2 && preview && (
        <section className="space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">
            Sprawdź, czy kolumny są dobrze rozpoznane
          </h2>
          <p className="max-w-3xl">
            W pliku „{file?.name}” jest {preview.summary.rows} {preview.summary.rows === 1 ? "wiersz" : "wierszy"}. Przy każdej kolumnie pokazujemy, za co ją uznaliśmy i dlaczego. Jeśli się pomyliliśmy,
            wybierz właściwą odpowiedź z listy.
          </p>
          {preview.fileFixes.length > 0 && (
            <ul className="max-w-3xl list-disc rounded border border-line bg-gov-light p-3 pl-8 text-sm">
              {preview.fileFixes.map((fix) => (
                <li key={fix.code}>{fix.message}</li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th scope="col" className="py-2 pr-3">Kolumna w pliku</th>
                  <th scope="col" className="py-2 pr-3">Przykładowe wartości</th>
                  <th scope="col" className="py-2 pr-3">Co to jest</th>
                  <th scope="col" className="py-2">Dlaczego</th>
                </tr>
              </thead>
              <tbody>
                {preview.columns.map((column, index) => (
                  <tr key={column.header} className="border-b border-line align-top">
                    <th scope="row" id={`kolumna-${index}`} className="py-2 pr-3 font-semibold">
                      {column.header}
                    </th>
                    <td className="py-2 pr-3 text-muted">{column.samples.length > 0 ? column.samples.join(" · ") : "(pusta)"}</td>
                    <td className="py-2 pr-3">
                      <select aria-labelledby={`kolumna-${index}`} value={mapping[column.header] ?? ""} onChange={(event) => setMapping({ ...mapping, [column.header]: event.target.value || null })} className="w-full rounded border border-muted bg-white px-2 py-1.5">
                        <option value="">— pomiń tę kolumnę —</option>
                        {TARGET_GROUPS.map((group) => (
                          <optgroup key={group.title} label={group.title}>
                            {group.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-muted">{mapping[column.header] === column.target ? column.reason : "Twój wybór"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!hasName || !hasPosition) && (
            <p role="alert" className="max-w-3xl text-danger">
              {!hasName ? "Wskaż kolumnę z nazwą miejsca, w którym stoi urządzenie." : ""}
              {!hasPosition ? "Wskaż kolumny z adresem albo ze współrzędnymi GPS, żebyśmy wiedzieli, gdzie urządzenie jest." : ""}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="rounded border-2 border-gov px-4 py-2 font-semibold text-gov">
              Wstecz
            </button>
            <button type="button" disabled={busy || !hasName || !hasPosition} onClick={async () => file && (await loadPreview(file, mapping)) && setStep(3)} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark disabled:bg-muted">
              {busy ? "Sprawdzam…" : "Dalej"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && preview && (
        <section className="space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">
            Zobacz, co poprawiliśmy i na co warto spojrzeć
          </h2>
          <dl className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Gotowe do wysłania", preview.summary.ready],
              ["Poprawione przez nas", preview.summary.withFixes],
              ["Już mamy w bazie", preview.summary.duplicates],
              ["Wymagają Twojej uwagi", preview.summary.withErrors],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-line p-3">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <caption className="sr-only">Urządzenia odczytane z pliku, z poprawkami i uwagami</caption>
              <thead>
                <tr className="border-b-2 border-ink">
                  <th scope="col" className="py-2 pr-3">Miejsce</th>
                  <th scope="col" className="py-2 pr-3">Adres</th>
                  <th scope="col" className="py-2 pr-3">Położenie</th>
                  <th scope="col" className="py-2">Poprawki i uwagi</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const record = row.record as Record<string, unknown>;
                  return (
                    <tr key={row.index} className="border-b border-line align-top">
                      <th scope="row" className="py-2 pr-3 font-semibold">{cell(record.nazwa)}</th>
                      <td className="py-2 pr-3">
                        {[record.nazwa_ulicy, record.nr_budynku].filter(Boolean).join(" ") || "—"}
                        <br />
                        {[record.kod_pocztowy, record.miejscowosc].filter(Boolean).join(" ")}
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {record.szerokosc_geograficzna == null ? <span className="font-sans font-semibold text-danger">brak położenia</span> : `${cell(record.szerokosc_geograficzna)}, ${cell(record.dlugosc_geograficzna)}`}
                      </td>
                      <td className="py-2">
                        <ul className="space-y-1">
                          {row.fixes.map((fix, index) => (
                            <li key={`f${index}`}>
                              <span className="font-semibold text-ok">Poprawiono:</span> {fix.message}
                            </li>
                          ))}
                          {row.issues.map((issue, index) => (
                            <li key={`i${index}`}>
                              <span className={`font-semibold ${issue.severity === "error" ? "text-danger" : "text-warn"}`}>{issue.severity === "error" ? "Do uzupełnienia:" : "Uwaga:"}</span> {issue.message}
                            </li>
                          ))}
                          {row.duplicateOf && (
                            <li>
                              <span className="font-semibold text-gov">Już w systemie:</span>{" "}
                              {row.duplicateOf.publication === "official"
                                ? `„${row.duplicateOf.nazwa}” już jest w oficjalnych danych (${row.duplicateOf.distanceM} m stąd). Zaktualizujemy ten wpis, nie dodamy drugiego.`
                                : `to urządzenie znaliśmy dotąd tylko z mapy społeczności (${row.duplicateOf.distanceM} m stąd). Twoje zgłoszenie je potwierdzi.`}
                            </li>
                          )}
                          {row.fixes.length + row.issues.length === 0 && !row.duplicateOf && <li className="text-muted">Bez uwag.</li>}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.summary.rows > preview.rows.length && <p className="text-sm text-muted">Dla czytelności pokazujemy pierwsze {preview.rows.length} wierszy, ale wyślemy wszystkie ({preview.summary.rows}).</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(2)} className="rounded border-2 border-gov px-4 py-2 font-semibold text-gov">
              Wstecz
            </button>
            <button type="button" onClick={() => setStep(4)} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark">
              Dalej
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <form
          className="max-w-2xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">
            Podpisz zgłoszenie
          </h2>
          {invitation && <p className="rounded border border-gov bg-gov-light p-3 text-sm">Dostałeś(-aś) zaproszenie od administratora zbioru, więc po wysłaniu dane pojawią się od razu.</p>}
          <div>
            <label htmlFor="dostawca" className="block font-semibold">
              Nazwa instytucji
            </label>
            <p id="dostawca-opis" className="text-sm text-muted">
              Pokażemy ją przy każdym urządzeniu jako źródło danych, na przykład „Urząd Miasta Marki”.
            </p>
            <input id="dostawca" required minLength={2} maxLength={200} autoComplete="organization" aria-describedby="dostawca-opis" value={provider.name} onChange={(event) => setProvider({ ...provider, name: event.target.value })} className="mt-1 w-full rounded border border-muted px-3 py-2" />
          </div>
          <div>
            <label htmlFor="email" className="block font-semibold">
              Adres e-mail instytucji <span className="font-normal text-muted">(nieobowiązkowy)</span>
            </label>
            <p id="email-opis" className="text-sm text-muted">
              Wyślemy tu przypomnienie, żeby potwierdzić, że dane są aktualne. Nie pokazujemy go publicznie.
            </p>
            <input id="email" type="email" autoComplete="email" aria-describedby="email-opis" value={provider.email} onChange={(event) => setProvider({ ...provider, email: event.target.value })} className="mt-1 w-full rounded border border-muted px-3 py-2" />
          </div>
          <fieldset>
            <legend className="font-semibold">Na jakich warunkach udostępniasz dane?</legend>
            {[
              { value: "CC0 1.0" as const, label: "Bez żadnych warunków (CC0 1.0)", hint: "Polecamy dla danych publicznych: każdy może z nich swobodnie korzystać." },
              { value: "CC BY 4.0" as const, label: "Z obowiązkiem podania źródła (CC BY 4.0)", hint: "Kto użyje tych danych, musi podać Twoją instytucję jako źródło." },
            ].map((option) => (
              <label key={option.value} className="mt-2 flex items-start gap-2">
                <input type="radio" name="licencja" value={option.value} checked={provider.licence === option.value} onChange={() => setProvider({ ...provider, licence: option.value })} className="mt-1 size-4" />
                <span>
                  {option.label}
                  <span className="block text-sm text-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2">
            <input type="checkbox" required checked={provider.confirmed} onChange={(event) => setProvider({ ...provider, confirmed: event.target.checked })} className="mt-1 size-4" />
            <span>Potwierdzam, że mogę udostępnić te dane i że nie ma w nich danych prywatnych osób, takich jak numery telefonów komórkowych czy imienne adresy e-mail.</span>
          </label>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(3)} className="rounded border-2 border-gov px-4 py-2 font-semibold text-gov">
              Wstecz
            </button>
            <button type="submit" disabled={busy} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark disabled:bg-muted">
              {busy ? "Wysyłam…" : "Wyślij zgłoszenie"}
            </button>
          </div>
        </form>
      )}

      {step === 5 && result && (
        <section className="max-w-3xl space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">
            {result.status === "published" ? "Dziękujemy, urządzenia są już w bazie" : "Dziękujemy, zgłoszenie przyjęte"}
          </h2>
          <p>
            {result.status === "published"
              ? "Dane są już widoczne na mapie, a przy najbliższej aktualizacji pojawią się też na portalu dane.gov.pl."
              : "Administrator zbioru musi je jeszcze zatwierdzić. Potem zobaczysz je na mapie i na portalu dane.gov.pl."}
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Nowe urządzenia: {result.added}</li>
            <li>Urządzenia, które już znaliśmy i połączyliśmy z Twoimi danymi: {result.merged}</li>
            {result.incomplete > 0 && <li>Do uzupełnienia (brakuje miejsca na mapie albo nazwy): {result.incomplete}</li>}
          </ul>
          <p>
            <a href={result.files.csv} className="font-semibold text-gov underline">
              Pobierz swoje uporządkowane dane (CSV)
            </a>
            . Możesz je też wgrać na stronę swojej instytucji w dane.gov.pl.
          </p>
          <p>
            <Link href="/jakosc" className="text-gov underline">
              Zobacz, co sprawdziliśmy w Twoim pliku
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
