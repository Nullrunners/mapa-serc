import Link from "next/link";
import type { GapsMethod } from "@/lib/api/client";
import { count } from "@/lib/format";

/** "Jak to liczymy": the method in plain words, with the figures the API used. */
export function Method({ method }: { method: GapsMethod }) {
  const { devices } = method;
  return (
    <details className="rounded-lg border border-line px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-gov">Jak to liczymy</summary>
      <div className="mt-3 space-y-2">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Mieszkańcy: spis powszechny 2021 (kwadraty 1 × 1 km), rozłożeni po równo na sześciokąty ok. 0,1 km².</li>
          <li>
            AED liczy się, jeśli stoi do {method.reachM} m od środka sześciokąta (kilka minut biegu tam i z powrotem) i jest wtedy dostępny. „W nocy” to niedziela, {method.nightHour.replace("niedziela ", "")}.
          </li>
          <li>
            Nowe miejsca wybieramy tam, gdzie całodobowy AED obejmie najwięcej osób bez AED w pobliżu. Osoby 65+ liczymy {method.seniorWeight === 3 ? "potrójnie" : `${method.seniorWeight} razy`}.
          </li>
          <li>
            Godziny znamy dla {count(devices.hours)} z {count(devices.total)} urządzeń. Bez godzin: na zewnątrz całą dobę ({count(devices.outdoor)}), w budynku pn–pt 8–16 ({count(devices.assumed)}). Nie
            liczymy {count(devices.excluded)} niedostępnych.
          </li>
          <li>
            Znamy tylko część defibrylatorów. Brakuje jakiegoś?{" "}
            <Link href="/dostawca" className="link">
              Zgłoś go
            </Link>
            .
          </li>
        </ul>
        <p className="text-muted">Źródła: {method.sources.map((source) => `${source.name} (${source.licence})`).join("; ")}. Wynik: licencja ODbL 1.0, poza zbiorem dla dane.gov.pl.</p>
      </div>
    </details>
  );
}
