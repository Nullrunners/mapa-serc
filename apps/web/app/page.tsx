import Finder from "@/components/finder";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Znajdź defibrylator AED</h1>
        <p className="max-w-3xl text-muted">
          Jeden ogólnopolski zbiór danych o defibrylatorach: ze zgłoszeń opiekunów urządzeń i ze zbiorów samorządów, w jednolitym układzie, gotowy do pobrania z portalu dane.gov.pl.
        </p>
      </div>
      <Finder />
    </div>
  );
}
