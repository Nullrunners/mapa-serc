import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import "./globals.css";

const openSans = Open_Sans({ variable: "--font-open-sans", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: { default: "AED Hub – defibrylatory w jednym zbiorze", template: "%s – AED Hub" },
  description: "Znajdź najbliższy defibrylator AED, zgłoś własny albo pobierz otwarte dane o wszystkich urządzeniach w Polsce.",
};

/** The header, the main area and the footer come from the group layouts: (map) for full-screen maps, (site) for the rest. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${openSans.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a href="#tresc" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">
          Przejdź do treści
        </a>
        {children}
      </body>
    </html>
  );
}
