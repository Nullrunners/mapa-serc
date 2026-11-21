import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import Wizard from "@/components/wizard";

export const metadata: Metadata = { title: "Zgłoś urządzenia" };

export default function ProviderPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Zgłoś swoje defibrylatory"
        lead="Masz listę urządzeń w urzędzie, szkole czy firmie? Wgraj ją, a resztą zajmiemy się my. Cztery krótkie kroki, bez instalowania czegokolwiek i bez programowania."
      />
      <Wizard />
    </div>
  );
}
