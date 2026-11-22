import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FIELDS, GROUPS, SCHEMA_VERSION, type FieldDef } from "@aed/schema";
import { PageHeader } from "@/components/ui";
import { API_URL } from "@/lib/api/client";
import { REQUIREMENT, VALUE_TYPE } from "@/lib/pattern-text";

export const metadata: Metadata = { title: "Wzorzec danych AED" };

const OTHER_FILES = [
  { href: "/dane/szablon.csv", label: "Szablon CSV" },
  { href: "/dane/wzorzec.md", label: "Opis pól (tekst)" },
  { href: "/dane/schema.json", label: "Schemat JSON", note: "dla programistów" },
  { href: "/dane/aed.csv-metadata.json", label: "Opis kolumn CSVW", note: "dla programistów" },
];

// Formats stay on one line, with plain hyphens, so a copied example works in a file.
const FILE_RULES: ReactNode[] = [
  "CSV w UTF-8, przecinki między kolumnami, nagłówek w pierwszym wierszu.",
  <>
    Liczby z kropką (52.2297), daty jako <span className="whitespace-nowrap">RRRR-MM-DD</span> (<span className="whitespace-nowrap">2026-11-21</span>).
  </>,
  "Brak danych: zostaw puste pole.",
];

/** Rendered from the same field catalogue that generates the CSV, the Table Schema and the API contract. */
export default function PatternPage() {
  const fields: readonly FieldDef[] = FIELDS;
  return (
    <div className="space-y-12">
      <PageHeader
        title="Wzorzec danych: lokalizacje defibrylatorów AED"
        lead={`Wersja ${SCHEMA_VERSION}. Co podać o każdym defibrylatorze, żeby dane z różnych miejsc dało się połączyć.`}
      />

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="pobierz" className="space-y-3">
          <h2 id="pobierz" className="text-lg font-bold">
            Pliki do pobrania
          </h2>
          <div className="space-y-1">
            <a href={`${API_URL}/dane/wzorzec.xlsx`} className="btn btn-primary">
              Pobierz wzorzec w Excelu (XLSX)
            </a>
            <p className="hint">Opis pól, przykład i pusty szablon.</p>
          </div>
          <ul className="space-y-1 text-sm">
            {OTHER_FILES.map((file) => (
              <li key={file.href}>
                <a href={`${API_URL}${file.href}`} className="link">
                  {file.label}
                </a>
                {file.note && <span className="text-muted"> – {file.note}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="zasady" className="space-y-3">
          <h2 id="zasady" className="text-lg font-bold">
            Jak zapisać plik
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            {FILE_RULES.map((rule, index) => (
              <li key={index}>{rule}</li>
            ))}
          </ul>
        </section>
      </div>

      {GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`grupa-${group.id}`} className="space-y-3">
          <h2 id={`grupa-${group.id}`} className="text-lg font-bold">
            {group.title}
          </h2>
          <div role="region" aria-label={`Tabela: ${group.title}`} tabIndex={0} className="overflow-x-auto">
            <table className="data-table min-w-176">
              <thead>
                <tr>
                  <th scope="col" className="w-56">
                    Kolumna
                  </th>
                  <th scope="col" className="w-32">
                    Typ
                  </th>
                  <th scope="col" className="w-28">
                    Wymagalność
                  </th>
                  <th scope="col">Opis</th>
                  <th scope="col" className="w-48">
                    Przykład
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields
                  .filter((field) => field.group === group.id)
                  .map((field) => (
                    <tr key={field.name}>
                      <th scope="row" className="font-mono font-semibold">
                        {field.name}
                      </th>
                      <td>{VALUE_TYPE[field.type]}</td>
                      <td className={field.requirement === "required" ? "font-semibold" : "text-muted"}>{REQUIREMENT[field.requirement]}</td>
                      <td>
                        {field.description}
                        {field.enum && (
                          <ul className="mt-1 list-disc pl-5">
                            {field.enum.map((value, index) => (
                              <li key={value}>
                                <code>{value}</code>
                                {field.enumLabels?.[index] ? ` – ${field.enumLabels[index]}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="font-mono">{String(field.example)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
