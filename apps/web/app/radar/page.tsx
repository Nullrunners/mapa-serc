import type { Metadata } from "next";
import Candidates from "@/components/candidates";

export const metadata: Metadata = { title: "Radar AED" };

export default function RadarPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Radar AED</h1>
        <p className="max-w-3xl text-muted">
          Tu szukamy defibrylatorów, o których urzędowe dane jeszcze nie wiedzą. Podpowiadają je ogłoszenia o zakupach publicznych i mapa tworzona przez społeczność. Przy każdej podpowiedzi pokazujemy, skąd ją mamy,
          a stąd można poprosić opiekuna urządzenia o potwierdzenie.
        </p>
      </div>
      <Candidates />
    </div>
  );
}
