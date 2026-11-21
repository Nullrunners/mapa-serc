import type { Metadata } from "next";
import Gaps from "@/components/gaps";

export const metadata: Metadata = { title: "Gdzie brakuje defibrylatorów" };

export default function GapsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 print:hidden">
        <h1 className="text-2xl font-bold">Gdzie brakuje defibrylatorów</h1>
        <p className="max-w-3xl text-muted">
          Sprawdź, ilu mieszkańców ma defibrylator w zasięgu kilku minut biegu, także w nocy i w weekend, kiedy urzędy i sklepy są zamknięte. Wskażemy miejsca, w których nowe urządzenie pomoże najwięcej
          osobom, i przygotujemy gotowe uzasadnienie do wniosku, na przykład do budżetu obywatelskiego.
        </p>
      </div>
      <Gaps />
    </div>
  );
}
