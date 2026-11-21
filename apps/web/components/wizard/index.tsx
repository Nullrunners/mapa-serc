"use client";

import { useEffect, useRef, useState } from "react";
import { api, problemMessage } from "@/lib/api/client";
import ColumnsStep from "./columns-step";
import DoneStep from "./done-step";
import FileStep from "./file-step";
import ReviewStep from "./review-step";
import type { Mapping, Preview, Provider, Result } from "./shared";
import SignStep from "./sign-step";

/** The four things the provider does; after the last one comes the summary. */
const STEPS = ["Wybierz plik", "Sprawdź kolumny", "Zobacz poprawki", "Podpisz zgłoszenie"] as const;
type Step = 1 | 2 | 3 | 4 | 5;

interface Source {
  name: string;
  base64: string;
}

/** File → base64 without building one enormous string of char codes at once. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** The provider's way in: a file in any layout → columns recognised → fixes reviewed → signed submission. */
export default function Wizard() {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [provider, setProvider] = useState<Provider>({ name: "", email: "", licence: "CC0 1.0", confirmed: false });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Token from an operator's invitation link (/dostawca?zaproszenie=…); such a submission is published at once.
  const [invitation, setInvitation] = useState<string | null>(null);

  // Move the focus to the heading of each new step, but not when the page opens.
  const heading = useRef<HTMLHeadingElement>(null);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (moved) heading.current?.focus();
  }, [step, moved]);
  const goTo = (next: Step) => {
    setStep(next);
    setMoved(true);
  };

  async function loadPreview(source: Source, chosen?: Mapping): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api
      .POST("/v1/import/preview", { body: { fileName: source.name, contentBase64: source.base64, ...(chosen ? { mapping: chosen } : {}) } })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(problemMessage(problem, "Nie udało się sprawdzić pliku. Spróbuj ponownie za chwilę."));
      return false;
    }
    setPreview(data);
    setMapping(Object.fromEntries(data.columns.map((column) => [column.header, column.target])));
    return true;
  }

  async function chooseFile(chosen: File) {
    setInvitation(new URLSearchParams(window.location.search).get("zaproszenie"));
    const source = { name: chosen.name, base64: await toBase64(chosen) };
    setFile(source);
    if (await loadPreview(source)) goTo(2);
  }

  async function checkColumns() {
    if (file && (await loadPreview(file, mapping))) goTo(3);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const email = provider.email.trim();
    const { data, error: problem } = await api
      .POST("/v1/import/commit", {
        body: {
          fileName: file.name,
          contentBase64: file.base64,
          mapping,
          provider: { name: provider.name.trim(), licence: provider.licence, ...(email ? { email } : {}) },
          ...(invitation ? { invitation } : {}),
        },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) return setError(problemMessage(problem, "Nie udało się zapisać zgłoszenia. Spróbuj ponownie za chwilę."));
    setResult(data);
    goTo(5);
  }

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {error && (
        <p role="alert" className="rounded-lg border border-l-4 border-line border-l-danger p-3 text-danger">
          {error}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {busy ? "Trwa przetwarzanie pliku." : ""}
      </p>

      {step === 1 && <FileStep headingRef={heading} busy={busy} onFile={chooseFile} />}
      {step === 2 && preview && (
        <ColumnsStep headingRef={heading} fileName={file?.name ?? ""} preview={preview} mapping={mapping} onMapping={setMapping} busy={busy} onBack={() => goTo(1)} onNext={checkColumns} />
      )}
      {step === 3 && preview && <ReviewStep headingRef={heading} preview={preview} onBack={() => goTo(2)} onNext={() => goTo(4)} />}
      {step === 4 && <SignStep headingRef={heading} provider={provider} onProvider={setProvider} invitation={invitation !== null} busy={busy} onBack={() => goTo(3)} onSubmit={submit} />}
      {step === 5 && result && <DoneStep headingRef={heading} result={result} email={provider.email.trim()} />}
    </div>
  );
}

/** Where the provider is: done steps ticked, the current one named. On a phone only the current step has its name shown. */
function Stepper({ step }: { step: Step }) {
  return (
    <ol aria-label="Kroki zgłoszenia" className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((title, index) => {
        const number = index + 1;
        const state = number === step ? "current" : number < step ? "done" : "todo";
        return (
          <li key={title} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-2">
            <span
              aria-hidden
              className={`flex size-7 shrink-0 items-center justify-center rounded-full font-bold ${state === "current" ? "bg-gov text-white" : state === "done" ? "bg-gov-light text-gov" : "border border-field text-muted"}`}
            >
              {state === "done" ? "✓" : number}
            </span>
            <span className="sr-only">
              Krok {number} z {STEPS.length}
              {state === "done" ? ", zakończony" : ""}: {title}
            </span>
            <span aria-hidden className={state === "current" ? "font-semibold" : "hidden text-muted sm:inline"}>
              {title}
            </span>
            {number < STEPS.length && <span aria-hidden className="mx-1 h-px w-4 bg-field sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}
