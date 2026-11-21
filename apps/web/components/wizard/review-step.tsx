import type { Ref } from "react";
import { Stats } from "@/components/ui";
import { StepButtons, StepHeading, cell, type Preview } from "./shared";

type Row = Preview["rows"][number];

export default function ReviewStep({ headingRef, preview, onBack, onNext }: { headingRef: Ref<HTMLHeadingElement>; preview: Preview; onBack: () => void; onNext: () => void }) {
  const { summary } = preview;
  return (
    <section className="space-y-5">
      <StepHeading headingRef={headingRef}>Zobacz, co poprawiliśmy i na co warto spojrzeć</StepHeading>
      <Stats
        className="max-w-3xl grid-cols-2 sm:grid-cols-4"
        items={[
          { label: "Gotowe do wysłania", value: summary.ready },
          { label: "Poprawione przez nas", value: summary.withFixes },
          { label: "Już mamy w bazie", value: summary.duplicates },
          { label: "Wymagają Twojej uwagi", value: summary.withErrors },
        ]}
      />

      <div className="overflow-x-auto">
        <table className="data-table min-w-208">
          <caption className="sr-only">Urządzenia odczytane z pliku, z poprawkami i uwagami</caption>
          <thead>
            <tr>
              <th scope="col">Miejsce</th>
              <th scope="col">Adres</th>
              <th scope="col">Położenie</th>
              <th scope="col">Poprawki i uwagi</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const record = row.record as Record<string, unknown>;
              return (
                <tr key={row.index}>
                  <th scope="row" className="font-semibold">
                    {cell(record.nazwa)}
                  </th>
                  <td>
                    {[record.nazwa_ulicy, record.nr_budynku].filter(Boolean).join(" ") || "—"}
                    <br />
                    {[record.kod_pocztowy, record.miejscowosc].filter(Boolean).join(" ")}
                  </td>
                  <td className="font-mono">
                    {record.szerokosc_geograficzna == null ? (
                      <span className="font-sans font-semibold text-danger">brak położenia</span>
                    ) : (
                      `${cell(record.szerokosc_geograficzna)}, ${cell(record.dlugosc_geograficzna)}`
                    )}
                  </td>
                  <td>
                    <Notes row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {summary.rows > preview.rows.length && <p className="hint">Dla czytelności pokazujemy pierwsze {preview.rows.length} wierszy, ale wyślemy wszystkie ({summary.rows}).</p>}

      <StepButtons onBack={onBack}>
        <button type="button" onClick={onNext} className="btn btn-primary">
          Dalej
        </button>
      </StepButtons>
    </section>
  );
}

/** What we fixed in a row, what the provider should fill in, and whether we already know the device. */
function Notes({ row }: { row: Row }) {
  const duplicate = row.duplicateOf;
  if (row.fixes.length + row.issues.length === 0 && !duplicate) return <span className="text-muted">Bez uwag.</span>;
  return (
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
      {duplicate && (
        <li>
          <span className="font-semibold text-gov">Już w systemie:</span>{" "}
          {duplicate.publication === "official"
            ? `„${duplicate.nazwa}” już jest w oficjalnych danych (${duplicate.distanceM} m stąd). Zaktualizujemy ten wpis, nie dodamy drugiego.`
            : `to urządzenie znaliśmy dotąd tylko z mapy społeczności (${duplicate.distanceM} m stąd). Twoje zgłoszenie je potwierdzi.`}
        </li>
      )}
    </ul>
  );
}
