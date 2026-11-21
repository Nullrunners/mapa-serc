"use client";

import { LoadStatus, Stats } from "@/components/ui";
import { api, API_URL, type SourceReport } from "@/lib/api/client";
import { count } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import SourceScope from "./source-scope";

const ORIGIN: Record<SourceReport["origin"], string> = {
  network: "pobrano ze źródła",
  snapshot: "ostatnia pobrana kopia",
  fixture: "kopia dołączona do projektu",
  database: "zgłoszenie zapisane w systemie",
  missing: "jeszcze nie pobrano",
};

const DOWNLOADS = [
  { label: "CSV", href: "/dane/aed.csv" },
  { label: "GeoJSON", href: "/dane/aed.geojson" },
  { label: "JSON-LD", href: "/dane/aed.jsonld" },
  { label: "XML dla portalu dane.gov.pl", href: "/feeds/dane-gov-pl.xml" },
];

const rowsWord = (rows: number) => (rows === 1 ? "wiersz" : "wierszy");

/** The quality report: how many devices we know, every source with what we fixed in it, and the scope of each one. */
export default function Sources() {
  const result = useLoad("sources", async (signal) => {
    const [sources, stats] = await Promise.all([api.GET("/v1/sources", { signal }), api.GET("/v1/stats", { signal })]);
    if (!sources.data || !stats.data) throw new Error("Nie udało się pobrać raportu. Spróbuj ponownie za chwilę.");
    return { sources: sources.data, stats: stats.data };
  });

  if (result.state !== "ready") return <LoadStatus of={result} />;
  const { sources, stats } = result.data;

  return (
    <div className="space-y-12">
      <div className="space-y-6">
        <Stats
          className="grid-cols-2 lg:grid-cols-4"
          items={[
            { label: "Urządzenia w oficjalnych danych", value: count(stats.official) },
            { label: "Jeszcze niepotwierdzone (OpenStreetMap)", value: count(stats.community) },
            { label: "Czekają na uzupełnienie", value: count(stats.incomplete) },
            { label: "Gminy, które mają dane", value: `${count(stats.communesWithOfficial)} z ${count(stats.communesTotal)}` },
          ]}
        />
        <section aria-labelledby="pobierz" className="space-y-2">
          <h2 id="pobierz" className="text-lg font-bold">
            Pobierz całą bazę w jednym pliku
          </h2>
          <div className="flex flex-wrap gap-2">
            {DOWNLOADS.map((file) => (
              <a key={file.href} href={`${API_URL}${file.href}`} className="btn btn-secondary btn-sm">
                {file.label}
              </a>
            ))}
          </div>
          <p className="hint">CSV otworzysz w Excelu. GeoJSON i JSON-LD są dla programów do map i dla programistów.</p>
        </section>
      </div>

      <section aria-labelledby="zrodla" className="space-y-4">
        <h2 id="zrodla" className="text-xl font-bold">
          Źródła danych
        </h2>
        <ul className="space-y-3">
          {sources.items.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </ul>
      </section>

      <SourceScope sources={sources.items} notIncluded={sources.notIncluded} />
    </div>
  );
}

function SourceCard({ source }: { source: SourceReport }) {
  const fixes = source.fileFixes.length + source.fixes.length;
  return (
    <li className="card space-y-2">
      <h3 className="text-lg font-bold">{source.name}</h3>
      <p className="text-sm text-muted">
        {source.attribution} · licencja {source.licence} · {ORIGIN[source.origin] ?? source.origin}
        {source.landingPage && (
          <>
            {" · "}
            <a href={source.landingPage} className="link">
              strona zbioru
            </a>
          </>
        )}
      </p>
      <p>
        Wierszy w pliku: <strong>{count(source.rows)}</strong>. W oficjalnych danych: <strong>{count(source.official)}</strong>
        {source.community > 0 && (
          <>
            , niepotwierdzone: <strong>{count(source.community)}</strong>
          </>
        )}
        {source.incomplete > 0 && (
          <>
            , do uzupełnienia: <strong>{count(source.incomplete)}</strong>
          </>
        )}
        .
      </p>
      {source.error && (
        <p role="alert" className="text-danger">
          {source.error}
        </p>
      )}
      {fixes > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-ok">Co poprawiliśmy ({fixes})</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-6">
            {source.fileFixes.map((fix) => (
              <li key={fix.code}>{fix.message}</li>
            ))}
            {source.fixes.map((line) => (
              <li key={line.code}>
                {line.example}{" "}
                <span className="text-muted">
                  ({line.count} {rowsWord(line.count)})
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {source.issues.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-warn">Do sprawdzenia przez dostawcę danych ({source.issues.length})</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-6">
            {source.issues.map((line) => (
              <li key={line.code}>
                {line.example}{" "}
                <span className="text-muted">
                  ({line.count} {rowsWord(line.count)})
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
