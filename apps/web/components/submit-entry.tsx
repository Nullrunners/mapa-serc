"use client";

import { POLAND } from "@aed/schema";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import DeviceForm from "@/components/device-form";
import Wizard from "@/components/wizard";
import type { Point } from "@/lib/route";

/** "52.39522,20.93138" from the map's link → the place the form's map starts at; anything else → none. */
function startingPoint(text: string | null): Point | null {
  const [lat, lon] = (text ?? "").split(",").map(Number);
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return lat >= POLAND.minLat && lat <= POLAND.maxLat && lon >= POLAND.minLon && lon <= POLAND.maxLon ? { lat, lon } : null;
}

/**
 * Two ways to report: one device on a map, or a whole list from a file. The choice is in the address
 * (?tryb=jeden, ?tryb=plik), so the browser's Back button returns to it and the map page can link straight to the form.
 */
export default function SubmitEntry() {
  const params = useSearchParams();
  // An operator's invitation (Radar) asks an institution for its list.
  if (params.has("zaproszenie")) return <Wizard />;

  const mode = params.get("tryb");
  if (mode === "plik")
    return (
      <div className="space-y-6">
        <OtherWay />
        <p className="max-w-3xl text-muted">Wgraj listę urządzeń z urzędu, szkoły czy firmy. Resztą zajmiemy się my.</p>
        <Wizard />
      </div>
    );
  if (mode === "jeden")
    return (
      <div className="space-y-6">
        <OtherWay />
        <DeviceForm initial={startingPoint(params.get("punkt"))} />
      </div>
    );

  return (
    <ul className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Way href="/dostawca?tryb=jeden" title="Jeden defibrylator">
        Zaznacz go na mapie i opisz w kilku słowach.
      </Way>
      <Way href="/dostawca?tryb=plik" title="Lista z pliku">
        Dla urzędów, szkół i firm: Excel albo CSV.
      </Way>
    </ul>
  );
}

function Way({ href, title, children }: { href: string; title: string; children: string }) {
  return (
    <li>
      <Link href={href} className="card block h-full space-y-1 transition-colors hover:border-gov hover:bg-gov-light">
        <span className="block text-lg font-bold text-gov">{title}</span>
        <span className="block text-muted">{children}</span>
      </Link>
    </li>
  );
}

function OtherWay() {
  return (
    <Link href="/dostawca" className="inline-block text-sm font-semibold text-gov hover:underline">
      <span aria-hidden>← </span>Inny sposób zgłoszenia
    </Link>
  );
}
