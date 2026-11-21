import type { GapsTotals } from "@/lib/api/client";
import { people } from "@/lib/gaps-text";

/**
 * Residents in three groups, as one bar and as a list with the numbers: the list carries the meaning, the colours only
 * help. "W nocy" is Sunday 3:00, as everywhere in the analysis.
 */
export function CoverageBar({ totals, reachM }: { totals: GapsTotals; reachM: number }) {
  const parts = [
    { label: "Mają AED w pobliżu, także w nocy", value: totals.residents - totals.noNight, color: "#0052a5" },
    { label: "Mają AED w pobliżu, ale nie w nocy", value: totals.noNight - totals.noDevice, color: "#9cbde3" },
    { label: `Nie mają AED w promieniu ${reachM} m`, value: totals.noDevice, color: "#7a0177" },
  ];
  const percent = (value: number) => (totals.residents > 0 ? Math.round((value / totals.residents) * 100) : 0);
  return (
    <figure className="space-y-2">
      <figcaption className="font-bold">Kto ma defibrylator w pobliżu</figcaption>
      <div aria-hidden className="flex h-4 overflow-hidden rounded-full bg-surface">
        {parts.map((part) => (
          <div key={part.label} style={{ width: `${(part.value / Math.max(1, totals.residents)) * 100}%`, background: part.color }} />
        ))}
      </div>
      <ul className="space-y-1 text-sm">
        {parts.map((part) => (
          <li key={part.label} className="flex items-baseline gap-2">
            <span aria-hidden className="inline-block size-3 shrink-0 translate-y-0.5 rounded-sm" style={{ background: part.color }} />
            <span className="flex-1">{part.label}</span>
            <span className="font-semibold tabular-nums">{people(part.value)}</span>
            <span className="w-10 text-right text-muted tabular-nums">{percent(part.value)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
