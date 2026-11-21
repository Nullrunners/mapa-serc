import type { Metadata } from "next";
import Wizard from "@/components/wizard";

export const metadata: Metadata = { title: "Zgłoś urządzenia" };

export default function ProviderPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Zgłoś swoje defibrylatory</h1>
        <p className="max-w-3xl text-muted">Masz listę urządzeń w urzędzie, szkole czy firmie? Wgraj ją, a my pomożemy resztę. Cztery krótkie kroki, nic nie trzeba instalować ani umieć programować.</p>
      </div>
      <Wizard />
    </div>
  );
}
