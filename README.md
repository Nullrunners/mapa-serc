# AED Hub

Rozwiązanie zadania **„Misja AED – dane na ratunek"** (HackNation 2026, Departament Zarządzania Danymi, Ministerstwo Cyfryzacji): jeden ogólnopolski, otwarty zbiór danych o defibrylatorach AED, gotowy do udostępnienia w portalu dane.gov.pl.

Dane urzędowe o AED to dziś cztery samorządowe pliki w portalu (74 urządzenia), każdy w innym układzie. Społeczność OpenStreetMap zna ponad 18 tysięcy urządzeń w 2128 gminach, ale na licencji ODbL, której portal nie ma w swoim słowniku licencji. AED Hub scala to, co już jest, w jednolity zbiór, a przede wszystkim ułatwia pozyskanie reszty: opiekun zgłasza urządzenie w kilku krokach, a system wskazuje, kogo o zgłoszenie poprosić.

## Co działa, a co jest w budowie

| Element | Stan |
|---|---|
| Wzorzec danych AED: 32 pola, z niego generowane Table Schema, szablon CSV, opis pól i schemat API | działa |
| Potok scalania: odczyt plików w dowolnym dialekcie, automatyczne poprawki, kody TERYT i geokodowanie z rejestrów GUGiK, deduplikacja, pochodzenie każdego pola, ocena jakości | działa |
| Pliki zbioru krajowego: CSV (RFC 4180), GeoJSON, JSON-LD, metadane CSVW | działa |
| Plik XML dla harvestera dane.gov.pl, zgodny z oficjalnym XSD 1.13 (sprawdzany w testach) | działa |
| Raport jakości dla każdego dostawcy | działa |
| Mapa z listą najbliższych urządzeń, strona wzorca, strona źródeł | działa; wygląd nie był jeszcze sprawdzany w przeglądarce |
| Kreator dla dostawcy: plik CSV lub GeoJSON w dowolnym układzie, automatyczne dopasowanie kolumn, podgląd poprawek i duplikatów, zgłoszenie, zatwierdzenie przez operatora | działa w API (testy); interfejs zbudowany, nie był jeszcze sprawdzany w przeglądarce |
| Kreator: pliki XLSX, podanie adresu istniejącego zbioru, formularz pojedynczego urządzenia | do zrobienia |
| Radar AED: wskazówki z mapy społeczności (gminy i operatorzy) i z ogłoszeń o zakupach publicznych, decyzja operatora, link zaproszenia dla opiekuna, publikacja zgłoszenia z zaproszenia | działa w API (testy); interfejs zbudowany, nie był jeszcze sprawdzany w przeglądarce |
| Radar: klasyfikacja ogłoszeń modelem językowym, wskazówki ze stron gmin i BIP | do zrobienia; dziś ogłoszenia odsiewa filtr słów kluczowych |
| Źródło: Warszawa | czeka na klucz do API miasta |

Zgłoszenie wysłane z kreatora bez tokenu operatora ma stan „oczekuje": dostawca widzi wynik, ale rekordy wchodzą do plików dla portalu dopiero po zatwierdzeniu (`POST /admin/sources/{id}/approve`). Niezatwierdzone zgłoszenie nie może też zmienić rekordów już opublikowanych. W wersji docelowej token operatora zastępuje tożsamość dostawcy z login.gov.pl.

## Liczby z przebiegu 21.11.2026

- 74 urządzenia w zbiorze urzędowym, z 4 gmin (Krosno, Przemyśl, Marki, Legionowo)
- 18 257 urządzeń znanych tylko z OpenStreetMap, pokazywanych jako niepotwierdzone, poza plikami dla portalu
- 36 urządzeń urzędowych potwierdzonych niezależnie przez OpenStreetMap; 21 par czeka na ręczne rozstrzygnięcie
- Radar: w 2128 gminach społeczność zna co najmniej jedno urządzenie, a tylko 4 gminy mają dane urzędowe; 108 operatorów ma po 5 i więcej urządzeń na mapie społeczności (ZUS 177, InPost 96, Tauron 69); 47 ogłoszeń z lat 2021–2026 o zakupie AED przez podmioty publiczne (m.in. Koszalin 40 sztuk, Szczecin 40 sztuk w listopadzie 2026, Toruń 29)
- poprawki wprowadzone automatycznie w plikach urzędowych: 7 wierszy z zamienionymi współrzędnymi, 29 adresów rozdzielonych z jednej kolumny, 1 urządzenie ze współrzędnymi skopiowanymi z innego miasta (położenie ustalone z adresu)

## Uruchomienie

Wymagane: Node.js 22.12 lub nowszy, pnpm 11, `xmllint` (do testu pliku XML). Na NixOS wszystko daje `nix develop` (albo direnv).

```bash
pnpm install
cp .env.example .env        # ustaw ADMIN_TOKEN i LINK_SECRET na losowe ciągi
pnpm dev:api                # http://localhost:8787, dokumentacja pod /docs
pnpm dev:web                # http://localhost:3000
```

Przy pierwszym starcie API buduje zbiór z kopii plików urzędowych dołączonych do repozytorium. Kolejne kroki:

```bash
pnpm job pipeline --refresh   # pobiera świeże pliki źródeł (także OpenStreetMap) i scala od nowa
pnpm job enrich-osm           # kody gmin dla warstwy OpenStreetMap; ok. 5 minut za pierwszym razem
pnpm job radar                # buduje wskazówki Radaru; za pierwszym razem pobiera ogłoszenia z e-Zamówień
pnpm check                    # typy i testy
```

Bazę (`data/aed.duckdb`) otwiera tylko proces API, dlatego zadania uruchamia się przez działające API, a nie osobnym skryptem.

## Układ repozytorium

```
packages/schema/   wzorzec danych: katalog pól i generatory (Table Schema, CSVW, opis pól, synonimy nagłówków)
apps/api/          Hono + TypeScript + DuckDB
  sources/         opisy źródeł: adres, licencja, sprawdzone mapowanie kolumn
  src/pipeline/    parse → normalize → geocode → dedup → merge
  src/publish/     CSV, GeoJSON, JSON-LD, XML harvestera
  src/contract/    kontrakt API (z niego powstaje openapi/openapi.json)
  test/fixtures/   zamrożone pliki źródeł i XSD portalu
  src/wizard.ts    kreator: podgląd pliku, zgłoszenie, zatwierdzenie
  src/radar/       Radar AED: budowanie wskazówek, decyzje, linki zaproszeń
apps/web/          Next.js: mapa z listą, kreator, wzorzec, źródła i jakość, Radar
```

Front korzysta wyłącznie z API, przez klienta generowanego z OpenAPI. Po zmianie kontraktu: `pnpm contract`, potem `pnpm --filter @aed/web api:types`.

## Wzorzec danych

Źródłem prawdy jest [packages/schema/src/fields.ts](packages/schema/src/fields.ts). Z działającego API można pobrać:

- `/dane/wzorzec.md` – opis pól
- `/dane/schema.json` – Frictionless Table Schema
- `/dane/szablon.csv` – szablon z przykładowym wierszem

Rdzeń adresowy wzorca jest identyczny z plikiem, który Legionowo już publikuje w portalu. Grupy pól odpowiadają francuskiej bazie krajowej Géo'DAE, a słowniki tagom OpenStreetMap (`emergency=defibrillator`); godziny dostępności zapisujemy w składni `opening_hours`.

## Publikacja w dane.gov.pl

Portal nie ma publicznego API zapisu. Dostawca rejestruje w portalu adres pliku XML, a harvester portalu pobiera go cyklicznie i sam zakłada oraz aktualizuje zbiór i zasoby. AED Hub wystawia taki plik pod `/feeds/dane-gov-pl.xml`; wskazuje on trzy zasoby: `/dane/aed.csv`, `/dane/aed.geojson`, `/dane/aed.jsonld`.

Schemat portalu przyjmuje wyłącznie adresy `https`, więc plik jest poprawny dopiero na wdrożeniu z ustawionym `PUBLIC_API_URL`. Lokalnie plik zawiera komentarz z tym ostrzeżeniem.

## Źródła danych i licencje

| Źródło | Licencja | Jak używamy |
|---|---|---|
| Urząd Miasta Krosna, zbiór 3624 w dane.gov.pl | CC0 1.0 | rekordy urzędowe |
| Urząd Miejski w Przemyślu, zbiór 4581 | CC0 1.0 | rekordy urzędowe |
| Urząd Miasta Legionowo, zbiór 40593 | CC0 1.0 | rekordy urzędowe |
| Urząd Miasta Marki, zbiór 4955 | CC BY 4.0 | rekordy urzędowe, z oznaczeniem źródła |
| OpenStreetMap przez openaedmap.org | ODbL 1.0 | osobna warstwa „niepotwierdzone" i potwierdzenie istnienia urządzeń; wartości pól z OSM nie trafiają do rekordów urzędowych ani do plików dla portalu |
| GUGiK: usługa geokodowania (UUG) i ULDK | – | kody TERYT i położenie z adresu |
| e-Zamówienia, ogłoszenia o wyniku postępowania (CPV 33182100-0) | – | wskazówki dla Radaru: kto kupił AED |

Zbiór krajowy jest publikowany na CC BY 4.0, bo taką licencję ma najbardziej wymagające źródło urzędowe. Każdy rekord ma kolumny `zrodlo` i `licencja`.

XSD harvestera i przykładowy plik XML w `apps/api/test/fixtures/harvester/` pochodzą z otwartego kodu portalu (kopia: github.com/olekstomek/mcod-backend-dane.gov.pl, gałąź `backend_2.62.3`).

## Wdrożenie

[compose.yaml](compose.yaml) opisuje obie usługi dla Coolify (zasób typu Docker Compose). Wymagane zmienne: `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `ADMIN_TOKEN`, `LINK_SECRET`. Obrazy nie były jeszcze budowane – na komputerze, na którym powstał kod, nie ma Dockera.

## Kod przygotowany przed startem

Regulamin dopuszcza wcześniej przygotowany kod pod warunkiem wskazania go:

- Całe repozytorium w obecnym kształcie powstało w sobotę 21.11.2026 między 9:45 a 11:00, przed publikacją pełnej karty zadania, na podstawie krótkiego opisu zadania ze strony hackathonu.
- Szkielet API (obsługa błędów, tabela endpointów ze stanem „zaślepka / działa", eksport OpenAPI, devShell Nix, wzorzec Dockerfile) jest przeniesiony z naszego projektu z NASA Space Apps Challenge 2026 (github.com/Nullrunners/backend).

## Narzędzia AI

Opis użycia narzędzi AI jest w [AI-USAGE.md](AI-USAGE.md).
