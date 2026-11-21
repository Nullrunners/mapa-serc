"use client";

import { Status } from "@/components/ui";
import { AVAILABILITY, ACCESS_LABEL, addressLine, hours, title, type When } from "@/lib/aed-text";
import type { AedItem } from "@/lib/api/client";
import { distance } from "@/lib/format";
import { reachSummary } from "@/lib/reach-text";

/** A device picked on the map or in a list. The position comes with it, so the map can fly there before the details arrive. */
export interface Picked {
  id: string;
  lat: number;
  lon: number;
}

export const pickedFrom = (item: AedItem): Picked => ({ id: item.id, lat: item.record.szerokosc_geograficzna, lon: item.record.dlugosc_geograficzna });

/**
 * Devices as a list; the whole row opens the device. `compact` leaves only the name, address and whether it is
 * available, for the short list of other devices next to the one already open.
 */
export default function DeviceList({ items, when = "now", compact = false, onPick }: { items: AedItem[]; when?: When; compact?: boolean; onPick: (picked: Picked) => void }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <li key={item.id} className="relative space-y-1 px-2 py-3 hover:bg-surface">
          {/* Top-aligned with equal line heights: a button's baseline is its last line, which would pull the distance down. */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="leading-snug font-semibold">
              {/* The button's ::after covers the row, so a tap anywhere on it opens the device. */}
              <button type="button" onClick={() => onPick(pickedFrom(item))} className="text-left text-gov after:absolute after:inset-0 hover:underline">
                {title(item)}
              </button>
            </h3>
            {item.distanceM !== null && (
              <span className="shrink-0 text-sm/[1.375rem] font-semibold tabular-nums">
                {distance(item.distanceM)}
                {compact && " stąd"}
              </span>
            )}
          </div>
          {addressLine(item) && <p className="text-sm">{addressLine(item)}</p>}
          {!compact && item.record.opis_lokalizacji && <p className="text-sm text-muted">{item.record.opis_lokalizacji}</p>}
          {item.reach && !compact ? (
            <ReachLine item={item} />
          ) : (
            <Status tone={AVAILABILITY[when][item.availableNow].tone} className="text-sm">
              {AVAILABILITY[when][item.availableNow].label}
            </Status>
          )}
          {!compact && <Facts item={item} />}
        </li>
      ))}
    </ol>
  );
}

/** Whether the device can be reached at the chosen moment, how soon, and why. */
function ReachLine({ item }: { item: AedItem }) {
  const summary = reachSummary(item.reach!, item.record.pietro);
  return (
    <div className="space-y-0.5 text-sm">
      <Status tone={summary.tone}>
        {summary.headline}
        {summary.eta && <span className="font-normal text-ink"> · {summary.eta}</span>}
      </Status>
      {summary.details.length > 0 && <p className="pl-4 text-muted">{summary.details.join(" · ")}</p>}
    </div>
  );
}

/** Opening hours, kind of access, and a mark on devices nobody has confirmed yet. */
function Facts({ item }: { item: AedItem }) {
  const { record } = item;
  const facts = [record.godziny_dostepnosci ? `Godziny: ${hours(record.godziny_dostepnosci)}` : null, record.dostep ? (ACCESS_LABEL[record.dostep] ?? record.dostep) : null].filter(Boolean);
  const unconfirmed = item.publication === "community";
  if (facts.length === 0 && !unconfirmed) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      {facts.map((fact) => (
        <span key={fact}>{fact}</span>
      ))}
      {unconfirmed && <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs font-semibold text-warn">niepotwierdzone</span>}
    </p>
  );
}
