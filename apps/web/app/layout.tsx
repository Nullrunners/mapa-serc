import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";
import "./globals.css";

const openSans = Open_Sans({ variable: "--font-open-sans", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: { default: "AED Hub – defibrylatory w jednym zbiorze", template: "%s – AED Hub" },
  description: "Znajdź najbliższy defibrylator AED, zgłoś własny albo pobierz otwarte dane o wszystkich urządzeniach w Polsce.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${openSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a href="#tresc" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">
          Przejdź do treści
        </a>
        <SiteHeader />
        <main id="tresc" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
