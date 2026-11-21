import Finder from "@/components/finder";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Znajdź defibrylator AED</h1>
        <p className="max-w-3xl text-muted">
          Mapa i lista defibrylatorów w całej Polsce. Zebraliśmy je w jednym miejscu z danych samorządów i zgłoszeń osób, które się nimi opiekują. Wpisz miejscowość albo pozwól nam sprawdzić, co jest najbliżej Ciebie.
        </p>
      </div>
      <Finder />
    </div>
  );
}
