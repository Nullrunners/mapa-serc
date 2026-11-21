import type { Metadata } from "next";
import Candidates from "@/components/candidates";

export const metadata: Metadata = { title: "Radar AED" };

export default function RadarPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Radar AED</h1>
        <p className="max-w-3xl text-muted">
          Wskazówki, gdzie są defibrylatory, których nie ma jeszcze w zbiorze urzędowym: ogłoszenia o zakupach publicznych i urządzenia znane z mapy społeczności. Każda wskazówka ma dowód i prowadzi do prośby o
          potwierdzenie przez opiekuna.
        </p>
      </div>
      <Candidates />
    </div>
  );
}
