import { FIELDS, GROUPS, SYSTEM_FIELDS, type FieldDef } from "@aed/schema";
import type { Ref } from "react";
import { StepButtons, StepHeading, type Mapping, type Preview } from "./shared";

/** What a column can be: a field of the pattern (without those the system fills in itself) or a composite column. */
const TARGET_GROUPS = [
  ...GROUPS.map((group) => ({
    title: group.title,
    options: (FIELDS as readonly FieldDef[])
      .filter((field) => field.group === group.id && !(SYSTEM_FIELDS as readonly string[]).includes(field.name))
      .map((field) => ({ value: field.name, label: field.title })),
  })).filter((group) => group.options.length > 0),
  {
    title: "Kolumny złożone",
    options: [
      { value: "adres", label: "Pełny adres w jednej kolumnie" },
      { value: "ulica", label: "Ulica razem z numerem" },
      { value: "wspolrzedne", label: "Obie współrzędne w jednej kolumnie" },
    ],
  },
];

/** Targets from which the place of a device can be found: coordinates, or an address to look up. */
const POSITION = ["szerokosc_geograficzna", "wspolrzedne", "adres", "ulica", "nazwa_ulicy"];

export interface ColumnsStepProps {
  headingRef: Ref<HTMLHeadingElement>;
  fileName: string;
  preview: Preview;
  mapping: Mapping;
  onMapping: (mapping: Mapping) => void;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}

export default function ColumnsStep({ headingRef, fileName, preview, mapping, onMapping, busy, onBack, onNext }: ColumnsStepProps) {
  const chosen = Object.values(mapping);
  const hasName = chosen.includes("nazwa");
  const hasPosition = POSITION.some((target) => chosen.includes(target));
  const { rows } = preview.summary;

  return (
    <section className="space-y-5">
      <StepHeading headingRef={headingRef}>Sprawdź, czy kolumny są dobrze rozpoznane</StepHeading>
      <p className="max-w-3xl">
        W pliku „{fileName}” jest {rows} {rows === 1 ? "wiersz" : "wierszy"}. Przy każdej kolumnie pokazujemy, za co ją uznaliśmy i dlaczego. Jeśli się pomyliliśmy, wybierz właściwą odpowiedź z listy.
      </p>
      {preview.fileFixes.length > 0 && (
        <ul className="max-w-3xl list-disc space-y-1 rounded-lg bg-surface py-3 pr-4 pl-8 text-sm">
          {preview.fileFixes.map((fix) => (
            <li key={fix.code}>{fix.message}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="data-table min-w-184">
          <thead>
            <tr>
              <th scope="col">Kolumna w pliku</th>
              <th scope="col">Przykładowe wartości</th>
              <th scope="col" className="w-72">
                Co to jest
              </th>
              <th scope="col">Dlaczego</th>
            </tr>
          </thead>
          <tbody>
            {preview.columns.map((column, index) => (
              <tr key={column.header}>
                <th scope="row" id={`kolumna-${index}`} className="font-semibold">
                  {column.header}
                </th>
                <td className="text-muted">{column.samples.length > 0 ? column.samples.join(" · ") : "(pusta)"}</td>
                <td>
                  <select
                    aria-labelledby={`kolumna-${index}`}
                    value={mapping[column.header] ?? ""}
                    onChange={(event) => onMapping({ ...mapping, [column.header]: event.target.value || null })}
                    className="field w-full py-1.5"
                  >
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
                <td className="text-muted">{mapping[column.header] === column.target ? column.reason : "Twój wybór"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(!hasName || !hasPosition) && (
        <p role="alert" className="max-w-3xl text-danger">
          {!hasName && "Wskaż kolumnę z nazwą miejsca, w którym stoi urządzenie. "}
          {!hasPosition && "Wskaż kolumny z adresem albo ze współrzędnymi GPS, żebyśmy wiedzieli, gdzie urządzenie jest."}
        </p>
      )}
      <StepButtons onBack={onBack}>
        <button type="button" disabled={busy || !hasName || !hasPosition} onClick={onNext} className="btn btn-primary">
          {busy ? "Sprawdzam…" : "Dalej"}
        </button>
      </StepButtons>
    </section>
  );
}
