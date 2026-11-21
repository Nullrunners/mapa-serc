import type { Metadata } from "next";
import Sources from "@/components/sources";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Źródła i jakość danych" };

export default function QualityPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Źródła i jakość danych" lead="Skąd mamy dane i co w nich poprawiliśmy." />
      <Sources />
    </div>
  );
}
