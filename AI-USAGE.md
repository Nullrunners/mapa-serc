# Użycie narzędzi AI

## Przy tworzeniu rozwiązania

Rozwiązanie zostało zaplanowane i w dużej części napisane z pomocą **Claude Code** (Anthropic), asystenta programowania, pracującego pod kierunkiem zespołu. Zespół wybrał zadanie, stos technologiczny i główny wyróżnik (Radar AED), rozstrzygał między wariantami proponowanymi przez asystenta i odpowiada za wynik.

Asystent był używany do:

- rozpoznania przed startem: karta analogicznego zadania z 2025 r., dostępne źródła danych o AED, sposób zasilania portalu dane.gov.pl, wzorce zagraniczne;
- planu architektury i kontraktu API;
- wzorca danych (katalog pól z opisami) i generatorów plików;
- potoku scalania, eksportów i pliku XML dla harvestera;
- kreatora dla dostawcy i Radaru AED (API i interfejs w Next.js);
- testów, plików wdrożeniowych i dokumentacji.

## W działającym produkcie

Scalanie danych jest deterministyczne: odczyt plików, poprawki, deduplikacja, ocena jakości i wszystkie pliki dla portalu powstają bez udziału modelu językowego. Te same dane wejściowe dają te same rekordy i te same identyfikatory.

W obecnej wersji żaden model językowy nie działa w produkcie: także wskazówki Radaru powstają z reguł (grupowanie urządzeń z mapy społeczności, filtr słów kluczowych dla ogłoszeń o zakupach).

Model językowy jest przewidziany w jednym miejscu, które jeszcze nie powstało: Radar AED ma nim rozpoznawać w ogłoszeniach o zakupach liczbę i rodzaj urządzeń razem z dosłownym cytatem. Wynik będzie wskazówką dla operatora, nigdy rekordem zbioru; cytat, którego nie ma w ogłoszeniu, będzie odrzucany.

Dane w zbiorze nie są generowane przez AI. Źródła są wymienione w [README.md](README.md).

## Poza repozytorium

<!-- Do uzupełnienia przez zespół przed zgłoszeniem: prezentacja, film, opis w HackTribe, ewentualne grafiki. -->

_Do uzupełnienia przez zespół._
