import Link from "next/link";
import type { Ref } from "react";
import { API_URL } from "@/lib/api/client";
import { StepHeading } from "./shared";

const ACCEPT = [
  ".xlsx",
  ".xls",
  ".csv",
  ".txt",
  ".json",
  ".geojson",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/json",
  "application/geo+json",
].join(",");

export default function FileStep({ headingRef, busy, onFile }: { headingRef: Ref<HTMLHeadingElement>; busy: boolean; onFile: (file: File) => void }) {
  return (
    <section className="max-w-2xl space-y-5">
      <StepHeading headingRef={headingRef}>Wybierz plik z listą defibrylatorów</StepHeading>
      <p>
        Wystarczy plik, który już masz, w dowolnym układzie kolumn. Nie musisz go przerabiać: sami zgadniemy, co jest czym, a Ty tylko to potwierdzisz. Arkusz z Excela możesz wgrać od razu, także w starszym
        formacie (.xls).
      </p>
      <div className="space-y-1.5">
        <label htmlFor="plik" className="label">
          Plik z urządzeniami
        </label>
        <p id="plik-opis" className="hint">
          Excel (.xlsx albo .xls), CSV lub GeoJSON, do 5 MB.
        </p>
        <input
          id="plik"
          type="file"
          accept={ACCEPT}
          aria-describedby="plik-opis"
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) onFile(chosen);
          }}
          className="field block w-full p-2 file:mr-3 file:rounded-md file:border-0 file:bg-gov file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-gov-dark"
        />
      </div>
      {busy && <p className="text-muted">Sprawdzam plik…</p>}
      <p className="text-sm">
        Nie masz jeszcze listy?{" "}
        <a href={`${API_URL}/dane/wzorzec.xlsx`} className="link">
          Pobierz szablon w Excelu
        </a>{" "}
        (wypełnij arkusz „Szablon”),{" "}
        <a href={`${API_URL}/dane/szablon.csv`} className="link">
          szablon CSV
        </a>{" "}
        albo zobacz{" "}
        <Link href="/wzorzec" className="link">
          opis wszystkich pól
        </Link>
        .
      </p>
    </section>
  );
}
