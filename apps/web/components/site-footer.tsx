import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** What every page says at its end: the emergency number, where the data comes from, and who made the site. */
export function FooterNotes() {
  return (
    <>
      <p className="text-ink">
        Nagły wypadek? Dzwoń{" "}
        <a href="tel:112" className="font-bold">
          112
        </a>
        .
      </p>
      <p className="max-w-4xl">
        Dane: instytucje podane przy urządzeniach (CC0 1.0 lub CC BY 4.0), niepotwierdzone © autorzy OpenStreetMap (ODbL). Mapa: OpenFreeMap © OpenMapTiles.
      </p>
      <p>
        {BRAND.name} – {BRAND.slogan}. Prototyp z HackNation 2026.{" "}
        <Link href="/dostepnosc" className="link">
          Dostępność
        </Link>
      </p>
    </>
  );
}

export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface text-sm text-muted print:hidden">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6">
        <FooterNotes />
      </div>
    </footer>
  );
}
