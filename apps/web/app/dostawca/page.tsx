import type { Metadata } from "next";
import Wizard from "@/components/wizard";

export const metadata: Metadata = { title: "Zgłoś urządzenia" };

export default function ProviderPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Zgłoś urządzenia do zbioru krajowego</h1>
        <p className="max-w-3xl text-muted">Cztery krótkie kroki i potwierdzenie. Bez instalowania czegokolwiek i bez wiedzy technicznej.</p>
      </div>
      <Wizard />
    </div>
  );
}
