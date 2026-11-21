import type { Metadata } from "next";
import Gaps from "@/components/gaps";

export const metadata: Metadata = { title: "Gdzie brakuje defibrylatorów" };

export default function GapsPage() {
  return (
    <Gaps
      title="Gdzie brakuje defibrylatorów"
      lead="Sprawdź, ilu mieszkańców ma defibrylator w zasięgu kilku minut biegu, także w nocy i w weekend. Wskażemy, gdzie nowe urządzenie pomoże najwięcej osobom, i przygotujemy uzasadnienie do wniosku, na przykład do budżetu obywatelskiego."
    />
  );
}
