import type { Metadata } from "next";
import Link from "next/link";
import LandingStats from "@/components/landing-stats";
import { LogoMark } from "@/components/logo";
import { PhoneIcon } from "@/components/site-header";
import { BRAND, MOBILE_APP_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "O projekcie",
  description: "Mapa serc zbiera dane o defibrylatorach AED z całej Polski w jeden otwarty zbiór dla dane.gov.pl.",
};

const PARTS = [
  { href: "/", title: "Znajdź AED", text: "Najbliższy defibrylator, który jest teraz otwarty, i droga pieszo do niego." },
  { href: "/braki", title: "Gdzie brakuje AED", text: "Miejsca, z których do defibrylatora jest za daleko, i gdzie postawić nowy." },
  { href: "/dostawca", title: "Zgłoś defibrylatory", text: "Jeden pinezką na mapie albo całą listę z pliku Excela." },
  { href: "/opiekun", title: "Opiekujesz się defibrylatorem?", text: "Naklejka z kodem QR i przypomnienia o terminach elektrod i baterii." },
  { href: "/radar", title: "Radar AED", text: "Defibrylatory, których jeszcze nie ma w danych urzędowych." },
  { href: "/wzorzec", title: "Otwarte dane", text: "Wzorzec danych dla urzędów i cała baza do pobrania za darmo." },
];

const STEPS = [
  { title: "Zgłaszasz", text: "Urząd, firma albo przechodzień dodaje defibrylator: z pliku albo na mapie." },
  { title: "Sprawdzamy", text: "Poprawiamy adresy i położenie, łączymy powtórzenia i oceniamy jakość." },
  { title: "Publikujemy", text: "Dane trafiają do portalu dane.gov.pl i każdy może z nich korzystać." },
];

/** The landing page: what Mapa serc is, the numbers today and a way into every part of the site. */
export default function AboutPage() {
  return (
    <div className="space-y-14">
      <section aria-labelledby="o-projekcie" className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div className="max-w-2xl space-y-4">
          <h1 id="o-projekcie" className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Każdy defibrylator w Polsce na jednej mapie
          </h1>
          <p className="text-lg text-muted">Zbieramy dane o defibrylatorach AED w jeden otwarty zbiór. Kiedy liczy się każda minuta, szybciej znajdziesz najbliższy.</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/" className="btn btn-primary btn-lg">
              Znajdź najbliższy AED
            </Link>
            <Link href="/dostawca" className="btn btn-secondary btn-lg">
              Zgłoś defibrylator
            </Link>
          </div>
        </div>
        <div aria-hidden className="hidden size-56 place-items-center rounded-full bg-gov-light md:grid lg:size-64">
          <LogoMark className="size-32 lg:size-36" />
        </div>
      </section>

      <LandingStats />

      <section aria-labelledby="co-zrobisz" className="space-y-4">
        <h2 id="co-zrobisz" className="text-xl font-bold">
          Co tu zrobisz
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PARTS.map((part) => (
            // The whole card answers a click; the link's name is only the title, so a screen reader's list stays short.
            <li key={part.href} className="card relative space-y-1 hover:border-gov hover:bg-gov-light/40">
              <h3 className="font-bold">
                <Link href={part.href} className="text-gov after:absolute after:inset-0 after:rounded-lg">
                  {part.title}
                </Link>
              </h3>
              <p className="text-sm text-muted">{part.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="jak-dziala" className="space-y-4">
        <h2 id="jak-dziala" className="text-xl font-bold">
          Jak to działa
        </h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-gov font-bold text-white">
                {index + 1}
              </span>
              <div className="space-y-1">
                <h3 className="font-bold">{step.title}</h3>
                <p className="text-sm text-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {MOBILE_APP_URL && (
        <section aria-labelledby="aplikacja" className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-gov-light p-6">
          <div className="space-y-1">
            <h2 id="aplikacja" className="text-xl font-bold">
              {BRAND.name} w telefonie
            </h2>
            <p className="text-muted">Najbliższy defibrylator zawsze pod ręką.</p>
          </div>
          <a href={MOBILE_APP_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
            <PhoneIcon />
            Pobierz aplikację
            <span className="sr-only"> (otworzy się w nowej karcie)</span>
          </a>
        </section>
      )}
    </div>
  );
}
