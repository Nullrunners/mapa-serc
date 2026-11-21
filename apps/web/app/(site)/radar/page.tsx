import type { Metadata } from "next";
import Candidates from "@/components/candidates";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Radar AED" };

export default function RadarPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Radar AED" lead="Defibrylatory, których brakuje w danych urzędowych. Podpowiadają je przetargi i mapa społeczności." />
      <Candidates />
    </div>
  );
}
