"use client";

import { api, API_URL } from "@/lib/api/client";
import { useLoad } from "@/lib/use-load";

const ORIGIN: Record<string, string> = {
  network: "pobrano ze źródła",
  snapshot: "ostatnia pobrana kopia",
  fixture: "kopia dołączona do projektu",
  database: "zgłoszenie zapisane w systemie",
  missing: "jeszcze nie pobrano",
};

export default function Sources() {
  const result = useLoad("sources", async (signal) => {
    const [sources, stats] = await Promise.all([api.GET("/v1/sources", { signal }), api.GET("/v1/stats", { signal })]);
    if (!sources.data || !stats.data) throw new Error("Nie udało się pobrać raportu. Spróbuj ponownie za chwilę.");
    return { sources: sources.data.items, stats: stats.data };
  });

  if (result.state === "loading") return <p className="text-muted">Wczytuję…</p>;
  if (result.state === "error")
    return (
      <p role="alert" className="text-danger">
        {result.message}
      </p>
    );
  const { sources, stats } = result.data;

  return (
    <div className="space-y-8">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Urządzenia w oficjalnych danych", stats.official],
          ["Jeszcze niepotwierdzone (OpenStreetMap)", stats.community],
          ["Czekają na uzupełnienie", stats.incomplete],
          ["Gminy, które mają dane", `${stats.communesWithOfficial} z ${stats.communesTotal}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-line p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-2xl font-bold">{typeof value === "number" ? value.toLocaleString("pl-PL") : value}</dd>
          </div>
        ))}
      </dl>

      <p>
        Pobierz całą bazę w jednym pliku:{" "}
        {[
          ["CSV", "/dane/aed.csv"],
          ["GeoJSON", "/dane/aed.geojson"],
          ["JSON-LD", "/dane/aed.jsonld"],
          ["plik XML dla portalu dane.gov.pl", "/feeds/dane-gov-pl.xml"],
        ].map(([label, href], index) => (
          <span key={href}>
            {index > 0 && ", "}
            <a href={`${API_URL}${href}`} className="text-gov underline">
              {label}
            </a>
          </span>
        ))}
        .
      </p>

      <div className="space-y-6">
        {sources.map((source) => (
          <section key={source.id} aria-labelledby={`zrodlo-${source.id}`} className="rounded border border-line p-4">
            <h2 id={`zrodlo-${source.id}`} className="text-lg font-bold">
              {source.name}
            </h2>
            <p className="text-sm text-muted">
              {source.attribution} · licencja {source.licence} · {ORIGIN[source.origin] ?? source.origin}
              {source.landingPage && (
                <>
                  {" · "}
                  <a href={source.landingPage} className="text-gov underline">
                    strona zbioru
                  </a>
                </>
              )}
            </p>
            <p className="mt-2">
              Wierszy w pliku: <strong>{source.rows.toLocaleString("pl-PL")}</strong>. W oficjalnych danych: <strong>{source.official.toLocaleString("pl-PL")}</strong>
              {source.community > 0 && (
                <>
                  , niepotwierdzone: <strong>{source.community.toLocaleString("pl-PL")}</strong>
                </>
              )}
              {source.incomplete > 0 && (
                <>
                  , do uzupełnienia: <strong>{source.incomplete}</strong>
                </>
              )}
              .
            </p>
            {source.error && (
              <p role="alert" className="mt-2 text-danger">
                {source.error}
              </p>
            )}
            {source.fileFixes.length + source.fixes.length > 0 && (
              <>
                <h3 className="mt-3 font-semibold text-ok">Poprawione przez nas</h3>
                <ul className="list-disc pl-6 text-sm">
                  {source.fileFixes.map((fix) => (
                    <li key={fix.code}>{fix.message}</li>
                  ))}
                  {source.fixes.map((line) => (
                    <li key={line.code}>
                      {line.example} <span className="text-muted">({line.count} {line.count === 1 ? "wiersz" : "wierszy"})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {source.issues.length > 0 && (
              <>
                <h3 className="mt-3 font-semibold text-warn">Do sprawdzenia przez dostawcę danych</h3>
                <ul className="list-disc pl-6 text-sm">
                  {source.issues.map((line) => (
                    <li key={line.code}>
                      {line.example} <span className="text-muted">({line.count} {line.count === 1 ? "wiersz" : "wierszy"})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
