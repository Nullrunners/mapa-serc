# Mapa serc – instrukcja dla jury

Zadanie: „Misja AED – dane na ratunek”. Poniżej są kroki, w których sprawdzicie każde wymaganie osobno: co otworzyć, co tam zobaczyć i gdzie leży to w kodzie.

- **Prototyp:** UZUPEŁNIĆ: adres strony (https)
- **Dokumentacja API:** adres API + `/docs`
- **Token administratora** (krok 5) jest w opisie zgłoszenia na platformie. Nie trzymamy go w repozytorium.
- **Przykładowy plik urzędu** do kroku 4: [zgloszenie/przyklad-pliku-urzedu.csv](zgloszenie/przyklad-pliku-urzedu.csv). Urządzenia w nim są zmyślone i mają to w nazwie.

## Jak działa całość, w jednym akapicie

Każdy dysponent (gmina, szpital, firma) publikuje w dane.gov.pl **własny** zbiór z danymi o swoich AED i sam za niego odpowiada. Mapa serc pomaga mu przygotować te dane według jednego wzorca: wczytuje plik w dowolnym układzie, poprawia go i wydaje gotowy plik CSV oraz plik XML dla harvestera portalu. **Portal** co noc zbiera wszystkie zbiory oznaczone tagiem `wykaz-aed` w jeden **wykaz zbiorczy**, tak jak dziś składa „Wykaz chronionych danych” (DGA). Przy każdym wierszu wykazu widać, który dysponent go dostarczył. Tę zmianę w kodzie portalu opisuje [portal/README.md](portal/README.md).

## Ścieżka przez prototyp, krok po kroku

1. **Znajdź AED** (strona główna). Pozwól na lokalizację albo wpisz adres. Zobaczysz najbliższe urządzenia z czasem dojścia, a przy każdym informację, czy jest dostępne teraz. „Prowadź mnie” prowadzi pieszo do urządzenia.
2. **Skąd te dane** (`/jakosc`). Tu widać wszystkie źródła, co w każdym poprawiliśmy i zakres danych każdego źródła na tle wzorca (tabela na dole strony). Przy każdym dostawcy są dwa linki: „dane we wzorcu (CSV)” i „plik dla harvestera (XML)”. To jest to, co dostawca publikuje w portalu pod własnym szyldem.
3. **Wzorzec danych** (`/wzorzec`). Opis 34 pól i pliki do pobrania, w tym skoroszyt XLSX (ten sam co [zgloszenie/wzorzec-danych-aed.xlsx](zgloszenie/wzorzec-danych-aed.xlsx)).
4. **Zgłoś urządzenia** (przycisk w prawym górnym rogu, `/dostawca`). Wybierz „Lista z pliku”, wgraj [zgloszenie/przyklad-pliku-urzedu.csv](zgloszenie/przyklad-pliku-urzedu.csv) i przejdź kreator:
   - system sam dopasuje kolumny,
   - pokaże poprawki: adres rozdzielony na ulicę i numer, przecinek dziesiętny, zamienione współrzędne w trzecim wierszu, godziny zapisane w jednolitej składni,
   - na końcu podaj nazwę dostawcy (np. „Jury – test”) i licencję CC0.

   Zgłoszenie dostaje stan „czeka na zatwierdzenie”.

   Jeden defibrylator zgłosi też każdy, bez pliku i bez logowania: wróć na `/dostawca` i wybierz „Jeden defibrylator”. Wpisz adres (np. Legionowo, Piłsudskiego 41) albo ustaw pinezkę na mapie, a formularz pokaże najbliższy adres i ostrzeże, jeśli obok jest już znane urządzenie. Podaj nazwę miejsca (np. „Jury – test”) i wyślij.
5. **Panel administratora** (`/admin`, strona nie jest w menu). Wpisz token, a potem przy swoim zgłoszeniu kliknij „Zatwierdź”. Panel pokaże link „Plik dla dane.gov.pl”. Przycisk „Odrzuć” usuwa zgłoszenie razem z jego urządzeniami. Pojedyncze urządzenia czekają w sekcji „Pojedyncze urządzenia” (po wpisaniu tokenu kliknij „Odśwież”). Po zatwierdzeniu urządzenie jest na mapie i we wspólnym źródle „Mapa serc (zgłoszenia użytkowników)” na stronie „Skąd te dane”, z własnym plikiem XML.
6. **Otwórz ten plik XML.** To zbiór jednego dostawcy w formacie harvestera dane.gov.pl (schemat 1.13). Zwróć uwagę na trzy rzeczy:
   - tytuł z nazwą dostawcy,
   - tag `wykaz-aed`,
   - zasób CSV z danymi tylko tego dostawcy.

   Ten adres dostawca podaje w portalu jako źródło danych swojej instytucji.
7. **Urządzenia na mapie i raport urządzenia.** Wróć do „Znajdź AED” i kliknij urządzenie, np. z Warszawy. Karta urządzenia pokazuje, skąd są dane. Z niej przejdziesz do raportu urządzenia (`/aed/{id}`) i naklejki z kodem QR do wydruku.
8. **Gdzie brakuje AED** (`/braki`). Mieszkańcy bez sprawnego defibrylatora w zasięgu 400 m, z podziałem na godziny tygodnia, oraz najlepsze miejsca na nowe urządzenia.
9. **Radar AED** (`/radar`). Wskazówki, kogo poprosić o dane: gminy, które kupiły AED (ogłoszenia z e-Zamówień), i urządzenia znane tylko z mapy społeczności.

## Gdzie sprawdzić każde wymaganie z treści zadania

| Wymaganie | Gdzie to zobaczyć | Gdzie w kodzie |
|---|---|---|
| Zebranie danych z wielu rozproszonych źródeł | krok 2: 5 zbiorów samorządów z dane.gov.pl (782 urządzenia) i OpenStreetMap jako osobna, niepotwierdzona warstwa | `apps/api/sources/`, `apps/api/src/pipeline/` |
| Wskazanie referencyjnego zakresu każdego źródła | krok 2, tabela „zakres danych”; plik `/dane/zakres-zrodel.csv` | `apps/api/src/pipeline/coverage.ts` |
| Integracja danych od wszystkich dysponentów w jednym zbiorze | wykaz zbiorczy w portalu: [portal/README.md](portal/README.md); podgląd scalonej listy: `/dane/aed.csv` | `portal/mcod-backend.patch` |
| Wzorcowy zakres danych (XLSX) | [zgloszenie/wzorzec-danych-aed.xlsx](zgloszenie/wzorzec-danych-aed.xlsx), krok 3 | `packages/schema/src/fields.ts` |
| Zgodność z zasadami portalu dane.gov.pl | kroki 5–6: zbiór każdego dostawcy pod jego instytucją, licencje z listy portalu (CC0 1.0, CC BY 4.0), plik XML zgodny z oficjalnym schematem harvestera | `apps/api/src/publish/harvester.ts`; test ze schematem XSD portalu: `apps/api/test/pipeline.test.ts` |
| Zmiana w logice portalu: scalanie wykazów w jedną listę | [portal/README.md](portal/README.md): co robi, porównanie z wykazem DGA, lista zmienionych plików | `portal/mcod-backend.patch`, testy: `portal/run-tests.sh` |
| Format odczytywalny maszynowo | `/dane/aed.csv`, `/dane/aed.geojson`, `/dane/aed.jsonld`, `/dane/aed.csv-metadata.json` (CSVW), `/dane/schema.json` (Table Schema) | `apps/api/src/publish/files.ts` |
| Zachęcenie dysponentów do udostępniania | kreator i zgłoszenie jednego urządzenia przez każdego (krok 4), Radar (krok 9), naklejki QR i raport urządzenia (krok 7), przypomnienia o terminach elektrod i baterii | `apps/web/components/wizard/`, `apps/web/components/device-form/`, `apps/api/src/submission/`, `apps/api/src/radar/`, `apps/api/src/passport/` |
| Nazwa akcji i hasło | „Mapa serc – dane na ratunek”, nagłówek każdej strony | `apps/web/lib/brand.ts` |
| Logotyp (JPG, PNG, PDF, format otwarty) i księga znaku (PDF) | UZUPEŁNIĆ: ścieżki plików w `zgloszenie/` | |
| Responsywność | każda strona działa w szerokości telefonu i komputera | `apps/web/` |
| Użycie AI | opis w zgłoszeniu na platformie | |

## Uruchomienie u siebie

Opis jest w [README.md](README.md#uruchomienie). Zmianę w kodzie portalu nakłada i testuje `portal/run-tests.sh` (potrzebny Python z pandas, openpyxl, pytest i django albo Nix).

## Ograniczenia, o których warto wiedzieć

- Zmianę w kodzie portalu sprawdziliśmy testami rdzenia (14 testów) i na naszych 782 urządzeniach. Nie uruchomiliśmy jej w pełnym środowisku portalu (Docker z bazą, Elasticsearchem i Celery), szczegóły w [portal/README.md](portal/README.md#ograniczenia).
- Logowanie przez mObywatel jest w wersji pokazowej: zamiast login.gov.pl jest ekran z przykładowymi osobami.
- E-maile i SMS-y bez skonfigurowanej bramki trafiają tylko do dziennika wiadomości (`/admin/outbox`).
- Dane z OpenStreetMap (ODbL) pokazujemy jako niepotwierdzone i nie trafiają do plików dla portalu, bo portal nie ma tej licencji na swojej liście.
