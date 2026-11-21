"use client";

import { FIELDS, GROUPS, SYSTEM_FIELDS, type FieldDef } from "@aed/schema";
import { api, API_URL, type SourceReport } from "@/lib/api/client";
import { useLoad } from "@/lib/use-load";

const REQUIREMENT = { required: "wymagane", recommended: "zalecane", optional: "opcjonalne" } as const;

/** The fields a source can deliver: the pattern without the columns the system fills in itself. */
const fields = (FIELDS as readonly FieldDef[]).filter((field) => !(SYSTEM_FIELDS as readonly string[]).includes(field.name));

const percent = (part: number, whole: number) => {
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "poniżej 1%" : `${Math.round(value)}%`;
};

function Cell({ source, field }: { source: SourceReport; field: string }) {
  const entry = source.coverage.find((candidate) => candidate.field === field);
  if (!entry || source.rows === 0) return <td className="px-3 py-2 text-muted">brak danych</td>;
  if (entry.provided === 0 && entry.added === 0) return <td className="px-3 py-2 text-muted">nie podaje</td>;
  return (
    <td className="px-3 py-2">
      {entry.provided > 0 && <span className={entry.provided === source.rows ? "font-semibold" : ""}>{percent(entry.provided, source.rows)}</span>}
      {entry.constant && <span className="block text-xs text-muted">jedna wartość dla całego źródła</span>}
      {entry.added > 0 && <span className="block text-xs text-ok">{entry.provided > 0 ? "+ " : ""}{percent(entry.added, source.rows)} uzupełnione z rejestrów</span>}
    </td>
  );
}

/**
 * The data scope of every source against the pattern: which share of a source's rows carries each field.
 * The pattern is the reference; the table shows how far each holder of data is from it.
 */
export default function SourceScope() {
  const result = useLoad("source-scope", async (signal) => {
    const { data } = await api.GET("/v1/sources", { signal });
    if (!data) throw new Error("Nie udało się pobrać zakresu danych źródeł. Spróbuj ponownie za chwilę.");
    return data;
  });

  if (result.state === "loading") return <p className="text-muted">Wczytuję…</p>;
  if (result.state === "error")
    return (
      <p role="alert" className="text-danger">
        {result.message}
      </p>
    );

  const sources = result.data.items.filter((source) => !source.awaitingApproval && source.coverage.length > 0);
  const { notIncluded } = result.data;

  return (
    <section aria-labelledby="zakres" className="space-y-4">
      <div className="space-y-2">
        <h2 id="zakres" className="text-xl font-bold">
          Zakres danych w każdym źródle
        </h2>
        <p className="max-w-3xl">
          Punktem odniesienia jest wzorzec danych. Tabela pokazuje, w jakiej części wierszy każde źródło podaje daną informację. Osobno zaznaczamy to, co system uzupełnił sam z rejestrów państwowych (kod gminy,
          położenie z adresu).
        </p>
        <p>
          <a href={`${API_URL}/dane/zakres-zrodel.csv`} className="text-gov underline">
            Pobierz tę tabelę jako plik CSV
          </a>
        </p>
      </div>

      {sources.length === 0 ? (
        <p className="text-muted">Zakres danych pojawi się po najbliższym scaleniu źródeł.</p>
      ) : (
        <div role="region" aria-labelledby="zakres" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-ink align-bottom">
                <th scope="col" className="w-56 py-2 pr-3">
                  Pole wzorca
                </th>
                <th scope="col" className="w-28 px-3 py-2">
                  We wzorcu
                </th>
                {sources.map((source) => (
                  <th key={source.id} scope="col" className="px-3 py-2">
                    {source.name}
                    <span className="block text-xs font-normal text-muted">
                      {source.rows.toLocaleString("pl-PL")} wierszy · {source.licence}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {GROUPS.map((group) => {
              const rows = fields.filter((field) => field.group === group.id);
              if (rows.length === 0) return null;
              return (
                <tbody key={group.id}>
                  <tr className="bg-gov-light">
                    <th scope="colgroup" colSpan={2 + sources.length} className="px-1 py-1.5 text-left font-semibold">
                      {group.title}
                    </th>
                  </tr>
                  {rows.map((field) => (
                    <tr key={field.name} className="border-b border-line align-top">
                      <th scope="row" className="py-2 pr-3 font-normal">
                        {field.title}
                        <span className="block font-mono text-xs text-muted">{field.name}</span>
                      </th>
                      <td className="px-3 py-2">{REQUIREMENT[field.requirement]}</td>
                      {sources.map((source) => (
                        <Cell key={source.id} source={source} field={field.name} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      {notIncluded.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-lg font-bold">Źródła, które znamy, ale ich nie włączamy</h3>
          <ul className="space-y-3">
            {notIncluded.map((source) => (
              <li key={source.id} className="rounded border border-line p-4">
                <p className="font-semibold">
                  <a href={source.url} className="text-gov underline">
                    {source.name}
                  </a>
                </p>
                <p className="text-sm text-muted">
                  {source.devices !== null ? `${source.devices.toLocaleString("pl-PL")} urządzeń według źródła` : "liczba urządzeń nieznana"} · {source.licence ? `licencja ${source.licence}` : "brak informacji o licencji"}
                </p>
                <p className="mt-2 text-sm">{source.scope}</p>
                <p className="mt-1 text-sm">
                  <strong>Dlaczego nie ma go w zbiorze:</strong> {source.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
