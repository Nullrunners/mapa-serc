# AED Hub

Rozwiązanie zadania **„Misja AED – dane na ratunek"** (HackNation 2026, Departament Zarządzania Danymi, Ministerstwo Cyfryzacji): jeden ogólnopolski, otwarty zbiór danych o defibrylatorach AED, gotowy do udostępnienia w portalu dane.gov.pl.

Dane urzędowe o AED to dziś pięć samorządowych zbiorów w portalu (782 urządzenia): cztery pliki i lista Warszawy wydawana przez API miasta, każdy w innym układzie. Społeczność OpenStreetMap zna ponad 18 tysięcy urządzeń w 2128 gminach, ale na licencji ODbL, której portal nie ma w swoim słowniku licencji. AED Hub scala to, co już jest, w jednolity zbiór, a przede wszystkim ułatwia pozyskanie reszty: opiekun zgłasza urządzenie w kilku krokach, a system wskazuje, kogo o zgłoszenie poprosić.

## Co działa, a co jest w budowie

| Element | Stan |
|---|---|
| Wzorzec danych AED: 34 pola, z niego generowane skoroszyt XLSX, Table Schema, szablon CSV, opis pól i schemat API | działa |
| Zakres danych każdego źródła na tle wzorca (tabela na stronie „Skąd te dane" i plik CSV), lista znanych źródeł, których nie włączamy | działa |
| „Dostępny teraz" w wyszukiwarce: odczyt godzin dostępności (także święta państwowe, `PH`), oznaczenie przy urządzeniu, filtr | działa |
| Ranking „Najszybciej w ręku" (`/v1/aed?sort=reach`): czas dojścia, godziny i święta, szafka z kodem albo recepcja, piętro, zgłoszone problemy; godzina zamknięcia lub otwarcia; sprawdzenie dowolnej chwili (`at`), w interfejsie „teraz" i noc z soboty na niedzielę | działa; sprawdzone na danych Warszawy. Sposób dostępu zgadujemy z opisu tylko przy jednoznacznych zwrotach („w portierni", „klucze"), nowe pole `sposob_dostepu` jest na razie puste we wszystkich źródłach |
| Cyfrowy Paszport AED: strona urządzenia pod kodem QR (`/aed/{id}`), naklejka 10 × 10 cm z kodem QR i logo akcji (logo to na razie znak zastępczy w `apps/web/public/logo.svg`), wszystkie naklejki dostawcy na kartkach A4 po cztery (`/naklejki`), zgłoszenia przechodniów („jest na miejscu", szafka zamknięta, brak urządzenia, alarm baterii, uszkodzenie), panel opiekuna (`/opiekun`) z terminami ważności elektrod i baterii i przyciskiem „Potwierdzam sprawność", który od razu zmienia status i datę weryfikacji w plikach dla portalu; karta urządzenia na mapie pokazuje potwierdzenia opiekuna i przechodniów oraz otwarte zgłoszenia z paszportu | działa; API w testach, strony i wydruk do PDF obejrzane w przeglądarce |
| Paszport: zgłoszenia przechodniów z limitami (jedno na godzinę od osoby, 30 dziennie od osoby, 20 dziennie na urządzenie); problem liczy się według liczby osób, nie kliknięć | działa w testach; bez captchy |
| Paszport: po publikacji zgłoszenia z kreatora dostawca dostaje e-mailem naklejki i linki do paneli opiekuna, a jego adres staje się adresem przypomnień; przypomnienia e-mail (SMTP) i SMS (SMSAPI.pl) 30 i 7 dni przed terminem i po nim, powiadomienie opiekuna o zgłoszonym problemie, link do panelu wysyłany na adres e-mail z danych urządzenia | działa w testach; bez `SMTP_URL` / `SMSAPI_TOKEN` wiadomości trafiają tylko do dziennika (`GET /admin/outbox`). Wiadomości dostają tylko ci, którzy sami podali adres: opiekunowie z paszportem i dostawcy, którzy wpisali e-mail w kreatorze |
| Paszport: logowanie opiekuna przez mObywatel (`/logowanie`, `/opiekun`). Opiekun, który wszedł do panelu linkiem, dodaje urządzenie do swojego konta i potem wchodzi już samym logowaniem, także prosto ze strony urządzenia po zeskanowaniu naklejki; „Moje defibrylatory” pokazują wszystkie jego urządzenia. Przy potwierdzeniu sprawności widać, że zrobiła to zalogowana osoba, a współopiekunowie widzą kto (imię i pierwsza litera nazwiska) | **wersja pokazowa**: zamiast login.gov.pl jest ekran z trzema zmyślonymi osobami do wyboru, więc logowanie niczego nie chroni i nie potwierdza tożsamości. Reszta (konta, sesje, urządzenia przy koncie, odłączanie) działa w testach API i była przeklikana w przeglądarce. Samo logowanie nie daje dostępu do urządzenia: potrzebny jest jeszcze link opiekuna |
| Naklejka NFC | na stronie naklejki przycisk zapisuje ten sam adres co w kodzie QR na naklejce NFC (Chrome na Androidzie), w innych przeglądarkach można skopiować adres; nie testowaliśmy tego na telefonie z prawdziwą naklejką |
| Potok scalania: odczyt plików w dowolnym dialekcie, automatyczne poprawki (także współrzędne w metrach, w układach PUWG 1992 i PUWG 2000), kody TERYT i geokodowanie z rejestrów GUGiK, deduplikacja, pochodzenie każdego pola, ocena jakości | działa |
| Pliki zbioru krajowego: CSV (RFC 4180), GeoJSON, JSON-LD, metadane CSVW | działa |
| Plik XML dla harvestera dane.gov.pl, zgodny z oficjalnym XSD 1.13 (sprawdzany w testach) | działa |
| Raport jakości dla każdego dostawcy | działa |
| Mapa z listą najbliższych urządzeń, strona wzorca, strona źródeł | działa; obejrzane na zrzutach ekranu w szerokości komputera i telefonu. W przeglądarce bez WebGL2 zamiast mapy jest komunikat, a lista działa dalej |
| Kreator dla dostawcy: plik Excela (.xlsx albo starszy .xls), CSV lub GeoJSON w dowolnym układzie, automatyczne dopasowanie kolumn, podgląd poprawek i duplikatów, zgłoszenie, zatwierdzenie przez operatora | działa w API (testy); interfejs zbudowany, nie był jeszcze sprawdzany w przeglądarce |
| Kreator: podanie adresu istniejącego zbioru, formularz pojedynczego urządzenia | do zrobienia |
| Radar AED: wskazówki z mapy społeczności (gminy i operatorzy) i z ogłoszeń o zakupach publicznych, decyzja operatora, link zaproszenia dla opiekuna, publikacja zgłoszenia z zaproszenia | działa w API (testy); interfejs zbudowany, nie był jeszcze sprawdzany w przeglądarce |
| Radar: klasyfikacja ogłoszeń modelem językowym, wskazówki ze stron gmin i BIP | do zrobienia; dziś ogłoszenia odsiewa filtr słów kluczowych |
| Źródło: Warszawa, 708 urządzeń z API miasta. Klucz (`WARSAW_API_KEY`) jest potrzebny tylko do pobrania świeżej listy; bez niego czytana jest kopia dołączona do repozytorium | działa |
| Łączenie rekordów po numerze urządzenia zapisanym w innym źródle (OpenStreetMap podaje numer z API Warszawy) | działa |
| „Gdzie brakuje AED" (`/braki`, `/v1/gaps`): mieszkańcy ze spisu 2021 w sześciokątach H3 na tle godzin tygodnia, w których sprawny defibrylator jest w zasięgu 400 m (bez przeterminowanych elektrod i baterii i bez zgłoszonych przez przechodniów jako brakujące); mapa luk, 10 najlepszych miejsc na nowe urządzenie w wybranym obszarze, raport miejsca z gotowym uzasadnieniem do wniosku (druk do PDF, CSV) | działa; sprawdzone w przeglądarce na komputerze i telefonie |
| Budynek-gospodarz z OpenStreetMap przy polecanym miejscu (szkoła, urząd, apteka) i ruch dzienny (dworce, galerie) w liczeniu potrzeb | do zrobienia |

Logowanie przez mObywatel w wersji docelowej to login.gov.pl (Węzeł Krajowy): serwis przekierowuje tam opiekuna, a z powrotem dostaje podpisane potwierdzenie z imieniem, nazwiskiem i numerem PESEL. Przyłączenie serwisu wymaga testów na środowisku integracyjnym, wniosku i zgody ministra właściwego do spraw informatyzacji ([gov.pl/web/login/dla-integratorow](https://www.gov.pl/web/login/dla-integratorow)), dlatego w prototypie tę wymianę zastępuje ekran pokazowy. Kod za nim jest ten sam, który obsłuży prawdziwe logowanie (`apps/api/src/auth/identity.ts`): z tożsamości zapisujemy imię, pierwszą literę nazwiska i skrót identyfikatora, nigdy sam PESEL.

Zgłoszenie wysłane z kreatora bez tokenu operatora ma stan „oczekuje": dostawca widzi wynik, ale rekordy wchodzą do plików dla portalu dopiero po zatwierdzeniu (`POST /admin/sources/{id}/approve`). Niezatwierdzone zgłoszenie nie może też zmienić rekordów już opublikowanych. W wersji docelowej token operatora zastępuje tożsamość dostawcy z login.gov.pl.

## Liczby z przebiegu 21.11.2026

- 782 urządzenia w zbiorze urzędowym, z 5 miast (Warszawa 708, Legionowo 24, Krosno 21, Przemyśl 21, Marki 8)
- 18 000 urządzeń znanych tylko z OpenStreetMap, pokazywanych jako niepotwierdzone, poza plikami dla portalu
- 297 urządzeń urzędowych potwierdzonych niezależnie przez OpenStreetMap; 130 par czeka na ręczne rozstrzygnięcie. Numer urządzenia z API Warszawy zapisany w OpenStreetMap połączył 21 par, których samo porównanie nazw i położenia nie łączyło
- Radar: w 2128 gminach społeczność zna co najmniej jedno urządzenie, a dane urzędowe ma 6 gmin (szósta tylko dlatego, że jedno urządzenie z listy Warszawy ma współrzędne w sąsiedniej gminie); 105 operatorów ma po 5 i więcej urządzeń na mapie społeczności (ZUS 177, InPost 96, Tauron 69); 47 ogłoszeń z lat 2021–2026 o zakupie AED przez podmioty publiczne (m.in. Koszalin 40 sztuk, Szczecin 40 sztuk w listopadzie 2026, Toruń 29)
- żaden z czterech plików z portalu nie podaje godzin dostępności, rodzaju dostępu, statusu ani daty weryfikacji urządzenia. Lista Warszawy podaje rodzaj dostępu dla wszystkich 708 urządzeń, a godziny opisuje słowami przy 612: 457 opisów system zapisał w składni `opening_hours`, 155 zostawił słowami w uwagach. OpenStreetMap podaje rodzaj dostępu dla 92% urządzeń, a godziny dla 37%
- w sobotę 21.11.2026 o 13:26 jako „dostępne teraz" dało się oznaczyć 103 z 782 urządzeń urzędowych i 4171 z 18 000 znanych tylko z OpenStreetMap
- poprawki wprowadzone automatycznie w czterech plikach z portalu: 7 wierszy z zamienionymi współrzędnymi, 29 adresów rozdzielonych z jednej kolumny, 1 urządzenie ze współrzędnymi skopiowanymi z innego miasta (położenie ustalone z adresu)
- luki w dostępie (urządzenia urzędowe i z OpenStreetMap razem, stan z 21.11.2026, 14:38): z 37,1 mln mieszkańców ujętych w siatce spisu 26,9 mln (73%) nie ma żadnego znanego defibrylatora w promieniu 400 m, a 32,7 mln (88%) nie ma takiego, który byłby dostępny w niedzielę o 3:00. W Warszawie to odpowiednio 0,76 mln (35%) i 1,77 mln (81%) z 2,18 mln. Godziny znamy dla 6410 z 18 782 urządzeń; dla 2682 stojących na zewnątrz bez godzin przyjmujemy całą dobę, dla 6541 pozostałych dni robocze 8–16, a 3149 urządzeń tylko dla personelu nie liczymy. Kraj liczy się w tle w ok. 26 s po starcie API, analiza Warszawy z rekomendacjami trwa ok. 1,5 s
- próba kreatora na prawdziwym pliku urzędu (Urząd Miasta Łodzi, arkusz `.xls`, 140 wierszy, same adresy): 118 urządzeń dostało położenie z adresu, w 61 wierszach miejscowość uzupełniono na podstawie pozostałych wierszy, 74 opisy godzin zapisano w składni `opening_hours`, a przy 98 wierszach system wskazał urządzenie, które już zna (pewne albo do sprawdzenia). Pliku nie ma w zbiorze, bo urząd nie podał warunków ponownego wykorzystania

## Uruchomienie

Wymagane: Node.js 22.12 lub nowszy, pnpm 11, `xmllint` (do testu pliku XML). Na NixOS wszystko daje `nix develop` (albo direnv).

```bash
pnpm install
cp .env.example .env        # ustaw ADMIN_TOKEN i LINK_SECRET na losowe ciągi
pnpm dev:api                # http://localhost:8787, dokumentacja pod /docs
pnpm dev:web                # http://localhost:3000
pnpm dev:mail               # nieobowiązkowe: lokalna skrzynka na e-maile, http://localhost:8025
```

E-maile z paszportu (naklejki, przypomnienia o terminach, zgłoszenia przechodniów) można czytać lokalnie. `pnpm dev:mail` uruchamia [Mailpit](https://mailpit.axllent.org/): serwer pocztowy, który niczego nie wysyła dalej, tylko pokazuje wiadomości w przeglądarce pod http://localhost:8025. W `.env` ustaw `SMTP_URL=smtp://localhost:1025` i uruchom API od nowa.

Przy pierwszym starcie API buduje zbiór z kopii plików urzędowych dołączonych do repozytorium. Kolejne kroki:

```bash
pnpm job pipeline --refresh   # pobiera świeże pliki źródeł (także OpenStreetMap) i scala od nowa
pnpm job enrich-osm           # kody gmin i adresy dla warstwy OpenStreetMap; kilkanaście minut za pierwszym razem
pnpm job radar                # buduje wskazówki Radaru; za pierwszym razem pobiera ogłoszenia z e-Zamówień
pnpm job reminders            # przypomnienia dla opiekunów (API uruchamia je też samo co godzinę)
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
  src/passport/    Cyfrowy Paszport AED: zgłoszenia przechodniów, panel opiekuna, przypomnienia
  src/auth/        konto opiekuna: logowanie przez mObywatel (w prototypie pokazowe), sesja, urządzenia przy koncie
  src/notify/      wysyłka e-mail (SMTP) i SMS (SMSAPI.pl) z dziennikiem wiadomości
  src/reach/       ranking „Najszybciej w ręku”
  src/gaps/        analiza luk: ludność w H3, godziny tygodnia urządzeń, wybór miejsc (zachłanny MCLP)
  reference/       ludność ze spisu 2021 w siatce 1 km (wycinek dla Polski)
apps/web/          Next.js: mapa z listą, kreator, wzorzec, źródła i jakość, Radar, mapa luk
zgloszenie/        pliki do zgłoszenia: wzorzec danych w XLSX
```

Front korzysta wyłącznie z API, przez klienta generowanego z OpenAPI. Po zmianie kontraktu: `pnpm contract`, potem `pnpm --filter @aed/web api:types`.

## Wzorzec danych

Źródłem prawdy jest [packages/schema/src/fields.ts](packages/schema/src/fields.ts). Z działającego API można pobrać:

- `/dane/wzorzec.xlsx` – skoroszyt Excela: tabela pól, słowniki, wiersz przykładowy i pusty szablon z listami wyboru
- `/dane/wzorzec.md` – opis pól
- `/dane/schema.json` – Frictionless Table Schema
- `/dane/szablon.csv` – szablon z przykładowym wierszem
- `/dane/zakres-zrodel.csv` – zakres danych każdego źródła na tle wzorca: jeden wiersz na źródło i pole

Kopia skoroszytu do zgłoszenia leży w [zgloszenie/wzorzec-danych-aed.xlsx](zgloszenie/wzorzec-danych-aed.xlsx). Po zmianie katalogu pól odtwarza ją `pnpm pattern`.

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
| Urząd m.st. Warszawy, zbiór 39512 (API „Otwarte dane po warszawsku") | CC BY 4.0 | rekordy urzędowe, z oznaczeniem źródła; kopia listy z 21.11.2026 jest w `apps/api/test/fixtures/sources/warszawa.json` |
| OpenStreetMap przez openaedmap.org | ODbL 1.0 | osobna warstwa „niepotwierdzone" i potwierdzenie istnienia urządzeń; wartości pól z OSM nie trafiają do rekordów urzędowych ani do plików dla portalu |
| GUGiK: usługa geokodowania (UUG) i ULDK | – | kody TERYT i położenie z adresu |
| e-Zamówienia, ogłoszenia o wyniku postępowania (CPV 33182100-0) | – | wskazówki dla Radaru: kto kupił AED |
| GUS, Narodowy Spis Powszechny 2021: ludność w siatce 1 km, w wydaniu Eurostatu (Census 2021 grid, wersja 3) | CC BY 4.0 | liczba mieszkańców i osób 65+ do analizy luk; wycinek dla Polski w `apps/api/reference/` (opis zmian w `NOTICE.txt`, odtwarza go `apps/api/scripts/fetch-population.ts`). Portal Geostatystyczny GUS nie podaje licencji i nie ma pliku do pobrania, stąd wydanie Eurostatu |

Zbiór krajowy jest publikowany na CC BY 4.0, bo taką licencję ma najbardziej wymagające źródło urzędowe. Każdy rekord ma kolumny `zrodlo` i `licencja`.

Wynik analizy luk (`/v1/gaps*`) korzysta z położeń urządzeń z OpenStreetMap, więc jest na licencji ODbL 1.0 i nie wchodzi do plików dla portalu.

Znamy też wykazy AED Łodzi, Krakowa i Gliwic oraz bazę ratujzsercem.pl. Żaden z nich nie ma podanej licencji, więc nie są w zbiorze; z powodami wymienia je strona „Skąd te dane" (`apps/api/src/pipeline/known.ts`). Przegląd portali otwartych danych Gdyni, Lublina i Metropolii GZM oraz krajowego katalogu metadanych z 21.11.2026 nie znalazł innych zbiorów AED.

XSD harvestera i przykładowy plik XML w `apps/api/test/fixtures/harvester/` pochodzą z otwartego kodu portalu (kopia: github.com/olekstomek/mcod-backend-dane.gov.pl, gałąź `backend_2.62.3`).

## Wdrożenie

[compose.yaml](compose.yaml) opisuje obie usługi dla Coolify (zasób typu Docker Compose). Wymagane zmienne: `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `ADMIN_TOKEN`, `LINK_SECRET`. Obrazy nie były jeszcze budowane – na komputerze, na którym powstał kod, nie ma Dockera.

Zmienne nieobowiązkowe:

- `SMTP_URL` i `MAIL_FROM` – wysyłka e-maili do opiekunów urządzeń (naklejki i linki do paszportów, przypomnienia o terminach, zgłoszenia przechodniów)
- `SMSAPI_TOKEN`, `SMS_FROM` i `SMSAPI_TEST` – te same wiadomości SMS-em przez SMSAPI.pl; `SMSAPI_TEST=1` sprawdza wysyłkę bez dostarczania i bez kosztów
- `MOBYWATEL_LOGIN` (domyślnie `demo`) – logowanie opiekuna przez mObywatel: `demo` to ekran pokazowy z przykładowymi osobami, `off` wyłącza logowanie i zostawia samo wejście linkiem. Na wdrożeniu z prawdziwymi opiekunami ustaw `off`, bo w trybie pokazowym każdy może wejść jako ta sama przykładowa osoba
- `TRUSTED_PROXY_HOPS` (domyślnie 1) – liczba serwerów pośredniczących przed API; limity zgłoszeń przechodniów biorą adres klienta z nagłówka `X-Forwarded-For`, z tego miejsca od końca

Bez zmiennych SMTP i SMSAPI wiadomości trafiają tylko do dziennika (`GET /admin/outbox`).

## Kod przygotowany przed startem

Regulamin dopuszcza wcześniej przygotowany kod pod warunkiem wskazania go:

- Stan repozytorium z commita `e61ee2d` powstał w sobotę 21.11.2026 między 9:45 a 11:00, przed publikacją pełnej karty zadania, na podstawie krótkiego opisu zadania ze strony hackathonu. Wszystko, co dodano później, powstało po zapoznaniu się z kartą.
- Szkielet API (obsługa błędów, tabela endpointów ze stanem „zaślepka / działa", eksport OpenAPI, devShell Nix, wzorzec Dockerfile) jest przeniesiony z naszego projektu z NASA Space Apps Challenge 2026 (github.com/Nullrunners/backend).

## Narzędzia AI

Opis użycia narzędzi AI jest w [AI-USAGE.md](AI-USAGE.md).
