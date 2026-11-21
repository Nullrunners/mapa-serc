import Finder from "@/components/finder";
import { PageHeader } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Znajdź defibrylator AED"
        lead="Defibrylatory z całej Polski w jednym miejscu: z danych samorządów i od osób, które się nimi opiekują. Wpisz miejscowość albo sprawdź, co jest najbliżej Ciebie."
      />
      <Finder />
    </div>
  );
}
