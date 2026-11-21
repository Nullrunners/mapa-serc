import type { Metadata } from "next";
import { FIELDS, GROUPS, SCHEMA_VERSION, type FieldDef } from "@aed/schema";
import { API_URL } from "@/lib/api/client";

export const metadata: Metadata = { title: "Wzorzec danych AED" };

const REQUIREMENT = { required: "wymagane", recommended: "zalecane", optional: "opcjonalne" } as const;
const TYPE = { string: "tekst", number: "liczba", boolean: "true / false", date: "data RRRR-MM-DD" } as const;

const DOWNLOADS = [
  { href: "/dane/szablon.csv", label: "Szablon CSV z przykładowym wierszem" },
  { href: "/dane/schema.json", label: "Table Schema (JSON) – do walidacji automatycznej" },
  { href: "/dane/wzorzec.md", label: "Opis pól (Markdown)" },
  { href: "/dane/aed.csv-metadata.json", label: "Metadane CSVW pliku krajowego" },
];

/** Rendered from the same field catalogue that generates the CSV, the Table Schema and the API contract. */
export default function PatternPage() {
  const fields: readonly FieldDef[] = FIELDS;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Wzorzec danych: lokalizacje defibrylatorów AED</h1>
        <p className="max-w-3xl text-muted">
          Wersja {SCHEMA_VERSION}. Jednolity zakres danych, w którym każdy dostawca udostępnia informacje o defibrylatorach. Plik CSV zgodny z RFC 4180: kodowanie UTF-8, separator przecinek, jeden wiersz nagłówka,
          liczby z kropką dziesiętną, daty w ISO 8601, puste pole oznacza brak danych.
        </p>
      </div>

      <section aria-labelledby="pobierz">
        <h2 id="pobierz" className="text-lg font-bold">
          Pliki do pobrania
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {DOWNLOADS.map((item) => (
            <li key={item.href}>
              <a href={`${API_URL}${item.href}`} className="text-gov underline">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`grupa-${group.id}`}>
          <h2 id={`grupa-${group.id}`} className="text-lg font-bold">
            {group.title}
          </h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th scope="col" className="w-56 py-2 pr-3">Kolumna</th>
                  <th scope="col" className="w-32 py-2 pr-3">Typ</th>
                  <th scope="col" className="w-28 py-2 pr-3">Wymagalność</th>
                  <th scope="col" className="py-2 pr-3">Opis</th>
                  <th scope="col" className="w-48 py-2">Przykład</th>
                </tr>
              </thead>
              <tbody>
                {fields
                  .filter((field) => field.group === group.id)
                  .map((field) => (
                    <tr key={field.name} className="border-b border-line align-top">
                      <th scope="row" className="py-2 pr-3 font-mono font-semibold">{field.name}</th>
                      <td className="py-2 pr-3">{TYPE[field.type]}</td>
                      <td className="py-2 pr-3">{REQUIREMENT[field.requirement]}</td>
                      <td className="py-2 pr-3">
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
                      <td className="py-2 font-mono">{String(field.example)}</td>
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
