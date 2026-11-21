import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const openSans = Open_Sans({ variable: "--font-open-sans", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: { default: "AED Hub – defibrylatory w jednym zbiorze", template: "%s – AED Hub" },
  description: "Znajdź najbliższy defibrylator AED, zgłoś własny albo pobierz otwarte dane o wszystkich urządzeniach w Polsce.",
};

const NAV = [
  { href: "/", label: "Znajdź AED" },
  { href: "/dostawca", label: "Zgłoś urządzenia" },
  { href: "/braki", label: "Gdzie brakuje AED" },
  { href: "/radar", label: "Radar AED" },
  { href: "/jakosc", label: "Skąd te dane" },
  { href: "/wzorzec", label: "Dla dostawców danych" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${openSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a href="#tresc" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2">
          Przejdź do treści
        </a>
        <header className="border-b-4 border-gov bg-white print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-xl font-bold text-gov">
              <LogoMark className="size-8" />
              {BRAND.name}
              <span className="text-sm font-normal text-muted">{BRAND.slogan}</span>
            </Link>
            <nav aria-label="Główna nawigacja">
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-gov underline-offset-4 hover:underline">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>
        <main id="tresc" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-line bg-gov-light text-sm text-muted print:hidden">
          <div className="mx-auto max-w-6xl space-y-1 px-4 py-4">
            <p>
              W nagłym wypadku dzwoń pod <strong className="text-ink">112</strong>. Dyspozytor wskaże najbliższy defibrylator i poprowadzi przez pierwszą pomoc.
            </p>
            <p>
              Dane urzędowe pochodzą od instytucji wymienionych przy każdym urządzeniu i są otwarte (licencja CC0 1.0 lub CC BY 4.0). Urządzenia oznaczone jako niepotwierdzone pochodzą z OpenStreetMap, © autorzy
              OpenStreetMap (ODbL). Mapa: OpenFreeMap © OpenMapTiles, dane © OpenStreetMap. Prototyp zrobiony na HackNation 2026.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
