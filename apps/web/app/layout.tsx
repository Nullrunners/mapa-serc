import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import { SETTINGS_SCRIPT } from "@/lib/display-settings";
import "./globals.css";

const openSans = Open_Sans({ variable: "--font-open-sans", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: { default: "Mapa serc – defibrylatory w jednym zbiorze", template: "%s – Mapa serc" },
  description: "Znajdź najbliższy defibrylator AED, zgłoś własny albo pobierz otwarte dane o wszystkich urządzeniach w Polsce.",
};

/** The header, the main area and the footer come from the group layouts: (map) for full-screen maps, (site) for the rest. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script puts the person's text size and contrast on <html> before anything is painted, so React is told
    // not to mind those attributes.
    <html lang="pl" className={`${openSans.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col font-sans">
        <a href="#tresc" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">
          Przejdź do treści
        </a>
        {children}
      </body>
    </html>
  );
}
