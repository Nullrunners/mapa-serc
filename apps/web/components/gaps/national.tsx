import type { GapsTotals } from "@/lib/api/client";
import { people, share } from "@/lib/gaps-text";

/** Residents, and how many of them have no device in reach at all and none at night, as rows of figures. */
export function Totals({ totals }: { totals: GapsTotals }) {
  const rows = [
    { label: "Mieszkańcy", value: people(totals.residents), note: "" },
    { label: "Bez AED w promieniu 400 m", value: people(totals.noDevice), note: share(totals.noDevice, totals.residents) },
    { label: "Bez AED dostępnego w nocy", value: people(totals.noNight), note: share(totals.noNight, totals.residents) },
  ];
  return (
    <dl className="divide-y divide-line rounded-lg bg-surface px-4">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt>
            {row.label}
            {row.note && <span className="block text-sm text-muted">{row.note}</span>}
          </dt>
          <dd className="shrink-0 text-lg font-bold tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
