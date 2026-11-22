import type { Metadata } from "next";
import Link from "next/link";
import LandingStats from "@/components/landing-stats";
import { LogoMark } from "@/components/logo";
import { PhoneIcon } from "@/components/site-header";
import { MOBILE_APP_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "O projekcie",
  description: "Mapa serc zbiera dane o defibrylatorach AED z całej Polski w jeden otwarty zbiór dla dane.gov.pl.",
};

interface Part {
  href: string;
  title: string;
  text: string;
}

// The first one is what most people come for, so it takes the whole first row on a narrow screen and two thirds on a wide one.
const PARTS: Part[] = [
  { href: "/", title: "Znajdź AED", text: "Najbliższy defibrylator, który jest teraz otwarty, i droga pieszo do niego." },
  { href: "/braki", title: "Gdzie brakuje AED", text: "Miejsca, z których do defibrylatora jest za daleko, i gdzie postawić nowy." },
  { href: "/dostawca", title: "Zgłoś defibrylatory", text: "Jeden pinezką na mapie albo całą listę z pliku Excela." },
  { href: "/opiekun", title: "Opiekujesz się defibrylatorem?", text: "Naklejka z kodem QR i przypomnienia o terminach elektrod i baterii." },
  { href: "/radar", title: "Radar AED", text: "Defibrylatory, których jeszcze nie ma w danych urzędowych." },
];

const DATA: Part[] = [
  { href: "/jakosc", title: "Skąd te dane", text: "Wszystkie źródła, co w nich poprawiliśmy, i cała baza do pobrania." },
  { href: "/wzorzec", title: "Wzorzec danych", text: "Co podać o każdym defibrylatorze. Szablon w Excelu dla urzędów i firm." },
];

const STEPS = [
  { title: "Zgłaszasz", text: "Urząd, firma albo przechodzień dodaje defibrylator: z pliku albo na mapie." },
  { title: "Sprawdzamy", text: "Poprawiamy adresy i położenie, łączymy powtórzenia i oceniamy jakość." },
  { title: "Publikujemy", text: "Dane trafiają do portalu dane.gov.pl i każdy może z nich korzystać." },
];

/** The landing page: what Mapa serc is, a way into every part of the site, the app and the open data. */
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

      <section aria-labelledby="co-zrobisz" className="space-y-4">
        <h2 id="co-zrobisz" className="text-xl font-bold">
          Co tu zrobisz
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PARTS.map((part, index) => (
            <PartCard key={part.href} part={part} className={index === 0 ? "border-gov sm:col-span-2" : ""} />
          ))}
        </ul>
      </section>

      <section id="aplikacja" aria-labelledby="aplikacja-tytul" className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-lg bg-gov-light p-6">
        <PhoneIcon className="hidden size-14 text-gov sm:block" />
        <div className="min-w-60 flex-1 space-y-1">
          <h2 id="aplikacja-tytul" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold">
            Aplikacja mobilna
            {!MOBILE_APP_URL && <span className="rounded-full border border-gov px-2.5 py-0.5 text-sm font-semibold text-gov">wkrótce</span>}
          </h2>
          <p className="text-muted">
            {MOBILE_APP_URL ? "Najbliższy defibrylator zawsze pod ręką." : "Do tego czasu otwórz tę stronę w telefonie: mapa działa tak samo."}
          </p>
        </div>
        {MOBILE_APP_URL && (
          <a href={MOBILE_APP_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
            <PhoneIcon />
            Pobierz aplikację
            <span className="sr-only"> (otworzy się w nowej karcie)</span>
          </a>
        )}
      </section>

      <section aria-labelledby="otwarte-dane" className="space-y-4">
        <h2 id="otwarte-dane" className="text-xl font-bold">
          Otwarte dane
        </h2>
        <LandingStats />
        <ul className="grid gap-3 sm:grid-cols-2">
          {DATA.map((part) => (
            <PartCard key={part.href} part={part} />
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
    </div>
  );
}

/** A part of the site. The whole card answers a click; the link's name is only the title, so a screen reader's list stays short. */
function PartCard({ part, className = "" }: { part: Part; className?: string }) {
  return (
    <li className={`card relative space-y-1 hover:border-gov hover:bg-gov-light/40 ${className}`}>
      <h3 className="font-bold">
        <Link href={part.href} className="text-gov after:absolute after:inset-0 after:rounded-lg">
          {part.title}
        </Link>
      </h3>
      <p className="text-sm text-muted">{part.text}</p>
    </li>
  );
}
