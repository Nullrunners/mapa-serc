import type { Metadata } from "next";
import Candidates from "@/components/candidates";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Radar AED" };

export default function RadarPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Radar AED"
        lead="Szukamy defibrylatorów, o których urzędowe dane jeszcze nie wiedzą. Podpowiadają je ogłoszenia o zakupach publicznych i mapa tworzona przez społeczność. Przy każdej wskazówce pokazujemy jej źródło, a opiekuna urządzenia można stąd poprosić o potwierdzenie."
      />
      <Candidates />
    </div>
  );
}
