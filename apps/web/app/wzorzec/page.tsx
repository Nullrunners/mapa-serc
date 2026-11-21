import type { Metadata } from "next";
import { FIELDS, GROUPS, SCHEMA_VERSION, type FieldDef } from "@aed/schema";
import { API_URL } from "@/lib/api/client";

export const metadata: Metadata = { title: "Wzorzec danych AED" };

const REQUIREMENT = { required: "wymagane", recommended: "zalecane", optional: "opcjonalne" } as const;
const TYPE = { string: "tekst", number: "liczba", boolean: "true / false", date: "data RRRR-MM-DD" } as const;

const DOWNLOADS = [
  { href: "/dane/wzorzec.xlsx", label: "Wzorzec danych w Excelu (XLSX): opis pól, słowniki, przykład i pusty szablon do wypełnienia" },
  { href: "/dane/szablon.csv", label: "Szablon CSV z przykładowym wierszem" },
  { href: "/dane/schema.json", label: "Schemat w JSON – dla programistów, do automatycznego sprawdzania plików" },
  { href: "/dane/wzorzec.md", label: "Opis wszystkich pól jako zwykły tekst" },
  { href: "/dane/aed.csv-metadata.json", label: "Opis kolumn pliku krajowego (CSVW) – dla programistów" },
];

/** Rendered from the same field catalogue that generates the CSV, the Table Schema and the API contract. */
export default function PatternPage() {
  const fields: readonly FieldDef[] = FIELDS;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Wzorzec danych: lokalizacje defibrylatorów AED</h1>
        <p className="max-w-3xl text-muted">
          Wersja {SCHEMA_VERSION}. To lista informacji, które prosimy podać o każdym defibrylatorze, żeby dane z różnych miejsc dało się połączyć. Plik zapisz jako CSV w UTF-8, z przecinkami między kolumnami i
          nagłówkiem w pierwszym wierszu. Liczby zapisuj z kropką, daty jako RRRR-MM-DD, a pole bez danych zostaw puste.
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
