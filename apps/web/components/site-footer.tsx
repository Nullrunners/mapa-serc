import { BRAND } from "@/lib/brand";

export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface text-sm text-muted print:hidden">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6">
        <p className="text-ink">
          W nagłym wypadku dzwoń pod{" "}
          <a href="tel:112" className="font-bold">
            112
          </a>
          . Dyspozytor wskaże najbliższy defibrylator i poprowadzi przez pierwszą pomoc.
        </p>
        <p className="max-w-4xl">
          Dane urzędowe pochodzą od instytucji wymienionych przy każdym urządzeniu i są otwarte (licencja CC0 1.0 lub CC BY 4.0). Urządzenia oznaczone jako niepotwierdzone pochodzą z OpenStreetMap, © autorzy
          OpenStreetMap (ODbL). Mapa: OpenFreeMap © OpenMapTiles, dane © OpenStreetMap.
        </p>
        <p>
          {BRAND.name} – {BRAND.slogan}. Prototyp zrobiony na HackNation 2026.
        </p>
      </div>
    </footer>
  );
}
