import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Dostępność" };

const WORKS = [
  "Całą stronę obsłużysz samą klawiaturą. Na początku każdej strony jest link „Przejdź do treści”.",
  "Czytnik ekranu odczyta przyciski, pola, komunikaty i wskazówki drogi do defibrylatora.",
  "Wszystko, co jest na mapie, znajdziesz też na liście obok niej.",
  "Tekst powiększysz do 200% (Ctrl i +), a strona dopasuje się do ekranu.",
  "Strona słucha ustawień systemu: większy kontrast, tryb dużego kontrastu w Windows i mniej ruchu.",
  "Kolor tylko pomaga: to samo jest zawsze napisane słowami.",
];

const Key = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-field bg-surface px-1.5 font-sans font-semibold">{children}</kbd>;

const KEYS: [ReactNode, string][] = [
  [<Key key="tab">Tab</Key>, "przejdź do mapy"],
  [<Key key="arrows">strzałki</Key>, "przesuń mapę"],
  [
    <span key="zoom">
      <Key>+</Key> i <Key>−</Key>
    </span>,
    "przybliż i oddal",
  ],
  [
    <span key="turn">
      <Key>Shift</Key> i <Key>strzałki</Key>
    </span>,
    "obróć i pochyl mapę",
  ],
  [<Key key="esc">Esc</Key>, "zamknij trasę w 3D albo przerwij zaznaczanie obszaru"],
];

const LIMITS = [
  "Trasę w 3D trzeba zobaczyć, a rozejrzeć się w niej można tylko, przeciągając widok. Te same wskazówki są pod nią słowami, a przy „Prowadź mnie” odczyta je czytnik ekranu.",
  "Obszar na mapie braków zaznaczysz prostokątem lub lassem tylko myszą albo palcem. Zamiast tego wybierz miasto albo wpisz miejscowość.",
];

export default function AccessibilityPage() {
  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader title="Dostępność" lead="Mapa serc ma działać dla każdego: z czytnikiem ekranu, samą klawiaturą i w powiększeniu." />

      <section aria-labelledby="dziala" className="space-y-3">
        <h2 id="dziala" className="text-lg font-bold">
          Co działa
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          {WORKS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="klawisze" className="space-y-3">
        <h2 id="klawisze" className="text-lg font-bold">
          Mapa z klawiatury
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {KEYS.map(([keys, action]) => (
            <div key={action} className="contents">
              <dt>{keys}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="ograniczenia" className="space-y-3">
        <h2 id="ograniczenia" className="text-lg font-bold">
          Czego jeszcze brakuje
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          {LIMITS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sprawdzenie" className="space-y-2">
        <h2 id="sprawdzenie" className="text-lg font-bold">
          Jak to sprawdziliśmy
        </h2>
        <p>
          Sami, 22 listopada 2026 r.: testem automatycznym axe-core na każdej stronie, samą klawiaturą, w powiększeniu 200% i w trybie dużego kontrastu. Strona jest
          częściowo zgodna z WCAG 2.2 na poziomie AA, z wyjątkami opisanymi wyżej.
        </p>
      </section>
    </div>
  );
}
