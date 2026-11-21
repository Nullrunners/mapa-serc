import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import Wizard from "@/components/wizard";

export const metadata: Metadata = { title: "Zgłoś urządzenia" };

export default function ProviderPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Zgłoś swoje defibrylatory" lead="Wgraj listę urządzeń z urzędu, szkoły czy firmy. Resztą zajmiemy się my." />
      <Wizard />
    </div>
  );
}
