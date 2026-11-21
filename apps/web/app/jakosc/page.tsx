import type { Metadata } from "next";
import SourceScope from "@/components/source-scope";
import Sources from "@/components/sources";

export const metadata: Metadata = { title: "Źródła i jakość danych" };

export default function QualityPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Źródła i jakość danych</h1>
        <p className="max-w-3xl text-muted">Skąd mamy dane o defibrylatorach, co poprawiliśmy sami i co musi jeszcze sprawdzić ich dostawca.</p>
      </div>
      <Sources />
      <SourceScope />
    </div>
  );
}
