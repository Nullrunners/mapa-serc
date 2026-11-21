import { FIELDS, GROUPS, SYSTEM_FIELDS, type FieldDef } from "@aed/schema";
import { API_URL, type KnownSource, type SourceReport } from "@/lib/api/client";
import { count } from "@/lib/format";
import { REQUIREMENT } from "@/lib/pattern-text";

/** The fields a source can deliver: the pattern without the columns the system fills in itself. */
const fields = (FIELDS as readonly FieldDef[]).filter((field) => !(SYSTEM_FIELDS as readonly string[]).includes(field.name));

const percent = (part: number, whole: number) => {
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "poniżej 1%" : `${Math.round(value)}%`;
};

function Cell({ source, field }: { source: SourceReport; field: string }) {
  const entry = source.coverage.find((candidate) => candidate.field === field);
  if (!entry || source.rows === 0) return <td className="text-muted">brak danych</td>;
  if (entry.provided === 0 && entry.added === 0) return <td className="text-muted">nie podaje</td>;
  return (
    <td>
      {entry.provided > 0 && <span className={entry.provided === source.rows ? "font-semibold" : ""}>{percent(entry.provided, source.rows)}</span>}
      {entry.constant && <span className="block text-xs text-muted">jedna wartość dla całego źródła</span>}
      {entry.added > 0 && (
        <span className="block text-xs text-ok">
          {entry.provided > 0 ? "+ " : ""}
          {percent(entry.added, source.rows)} uzupełnione z rejestrów
        </span>
      )}
    </td>
  );
}

/**
 * The data scope of every source against the pattern: which share of a source's rows carries each field.
 * The pattern is the reference; the table shows how far each holder of data is from it.
 */
export default function SourceScope({ sources: all, notIncluded }: { sources: SourceReport[]; notIncluded: KnownSource[] }) {
  const sources = all.filter((source) => !source.awaitingApproval && source.coverage.length > 0);

  return (
    <section aria-labelledby="zakres" className="space-y-4">
      <div className="max-w-3xl space-y-2">
        <h2 id="zakres" className="text-xl font-bold">
          Zakres danych w każdym źródle
        </h2>
        <p>
          Punktem odniesienia jest wzorzec danych. Tabela pokazuje, w jakiej części wierszy każde źródło podaje daną informację. Osobno zaznaczamy to, co system uzupełnił sam z rejestrów państwowych (kod gminy,
          położenie z adresu).
        </p>
        <p>
          <a href={`${API_URL}/dane/zakres-zrodel.csv`} className="link">
            Pobierz tę tabelę jako plik CSV
          </a>
        </p>
      </div>

      {sources.length === 0 ? (
        <p className="text-muted">Zakres danych pojawi się po najbliższym scaleniu źródeł.</p>
      ) : (
        <div role="region" aria-labelledby="zakres" tabIndex={0} className="overflow-x-auto">
          <table className="data-table min-w-4xl">
            <thead>
              <tr>
                <th scope="col" className="w-56">
                  Pole wzorca
                </th>
                <th scope="col" className="w-28">
                  We wzorcu
                </th>
                {sources.map((source) => (
                  <th key={source.id} scope="col">
                    {source.name}
                    <span className="block text-xs font-normal text-muted">
                      {count(source.rows)} wierszy · {source.licence}
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
                  <tr className="bg-surface">
                    <th scope="colgroup" colSpan={2 + sources.length} className="pl-2 font-semibold">
                      {group.title}
                    </th>
                  </tr>
                  {rows.map((field) => (
                    <tr key={field.name}>
                      <th scope="row" className="font-normal">
                        {field.title}
                        <span className="block font-mono text-xs text-muted">{field.name}</span>
                      </th>
                      <td>{REQUIREMENT[field.requirement]}</td>
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
        <section aria-labelledby="poza-zbiorem" className="space-y-3 pt-4">
          <h3 id="poza-zbiorem" className="text-lg font-bold">
            Źródła, które znamy, ale ich nie włączamy
          </h3>
          <ul className="space-y-3">
            {notIncluded.map((source) => (
              <li key={source.id} className="card space-y-1.5">
                <p className="font-semibold">
                  <a href={source.url} className="link">
                    {source.name}
                  </a>
                </p>
                <p className="text-sm text-muted">
                  {source.devices !== null ? `${count(source.devices)} urządzeń według źródła` : "liczba urządzeń nieznana"} · {source.licence ? `licencja ${source.licence}` : "brak informacji o licencji"}
                </p>
                <p className="text-sm">{source.scope}</p>
                <p className="text-sm">
                  <strong>Dlaczego nie ma go w zbiorze:</strong> {source.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
