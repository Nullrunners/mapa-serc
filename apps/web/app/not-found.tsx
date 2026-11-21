import Link from "next/link";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";
import { PageHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="tresc" className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:py-8">
        <PageHeader title="Nie ma takiej strony" lead="Sprawdź adres albo wróć do mapy." />
        <Link href="/" className="btn btn-primary">
          Znajdź defibrylator
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
