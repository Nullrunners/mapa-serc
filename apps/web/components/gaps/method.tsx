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
        <p>
          Dzielimy mapę na sześciokąty o powierzchni ok. 0,1 km². Liczbę mieszkańców bierzemy ze spisu powszechnego 2021, który podaje ją w kwadratach 1 × 1 km. Zakładamy, że w każdym kwadracie ludzie
          mieszkają równomiernie.
        </p>
        <p>
          Defibrylator liczy się dla sześciokąta, jeśli stoi najwyżej {method.reachM} m od jego środka: tyle da się przebiec tam i z powrotem w kilka minut. Liczymy też, przez ile godzin w tygodniu można do
          niego dojść. Urządzenie w urzędzie czynnym 7:30–15:30 pomaga tylko przez 40 ze 168 godzin. „W nocy” znaczy u nas: w niedzielę o {method.nightHour.replace("niedziela ", "")}.
        </p>
        <p>
          Miejsca na nowe urządzenia wybieramy po kolei. Każde następne stawiamy tam, gdzie defibrylator dostępny całą dobę obejmie najwięcej osób, które dziś go w pobliżu nie mają. Osoby w wieku 65+ liczymy{" "}
          {method.seniorWeight === 3 ? "potrójnie" : `${method.seniorWeight} razy`}, bo to u nich najczęściej dochodzi do nagłego zatrzymania krążenia.
        </p>
        <p>
          Godziny dostępności znamy dla {count(devices.hours)} z {count(devices.total)} urządzeń. Dla {count(devices.outdoor)} stojących na zewnątrz bez podanych godzin przyjmujemy całą dobę, a dla{" "}
          {count(devices.assumed)} pozostałych dni robocze 8–16. {count(devices.excluded)} urządzeń nie liczymy: są tylko dla personelu, wycofane, mają przeterminowane elektrody lub baterię albo przechodnie
          zgłosili, że ich nie ma. Dlatego liczba osób „bez żadnego AED” nie zależy od tych założeń, a liczba „bez AED w nocy” trochę tak.
        </p>
        <p>
          Wyniki są tak dobre jak dane: nie znamy każdego defibrylatora w Polsce, a część urządzeń pochodzi z OpenStreetMap i nie jest potwierdzona. Jeśli znasz defibrylator, którego brakuje,{" "}
          <Link href="/dostawca" className="link">
            zgłoś go
          </Link>
          .
        </p>
        <p className="text-muted">Źródła: {method.sources.map((source) => `${source.name} (${source.licence})`).join("; ")}. Wynik analizy jest na licencji ODbL 1.0 i nie wchodzi do zbioru dla dane.gov.pl.</p>
      </div>
    </details>
  );
}
