# Mapa serc

Rozwiązanie zadania **„Misja AED – dane na ratunek"** (HackNation 2026, Departament Zarządzania Danymi, Ministerstwo Cyfryzacji): jeden ogólnopolski, otwarty zbiór danych o defibrylatorach AED, gotowy do udostępnienia w portalu dane.gov.pl.

Dane urzędowe o AED to dziś pięć samorządowych zbiorów w portalu (782 urządzenia): cztery pliki i lista Warszawy wydawana przez API miasta, każdy w innym układzie. Społeczność OpenStreetMap zna ponad 18 tysięcy urządzeń w 2128 gminach, ale na licencji ODbL, której portal nie ma w swoim słowniku licencji. Mapa serc scala to, co już jest, w jednolity zbiór, a przede wszystkim ułatwia pozyskanie reszty: opiekun zgłasza urządzenie w kilku krokach, a system wskazuje, kogo o zgłoszenie poprosić.

Każdy dysponent publikuje w portalu własny zbiór i sam za niego odpowiada. Jedną listę dla całej Polski składa sam portal, podobnie jak dziś składa „Wykaz chronionych danych” (DGA). Zmiana w kodzie portalu jest w [portal/](portal/README.md).

**Dla jury:** [INSTRUKCJA-DLA-JURY.md](INSTRUKCJA-DLA-JURY.md).

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
| Pliki dla dane.gov.pl osobno dla każdego dostawcy: CSV we wzorcu i XML dla harvestera, zgodny z oficjalnym XSD 1.13 (sprawdzany w testach), z tagiem `wykaz-aed` | działa |
| Wykaz zbiorczy AED w portalu dane.gov.pl: zmiana w kodzie portalu ([portal/](portal/README.md)), która co noc scala zbiory wszystkich dostawców z tagiem `wykaz-aed` w jeden plik CSV, z dostawcą przy każdym wierszu | rdzeń działa w testach (14) i na naszych 782 urządzeniach; części portalowej nie uruchomiliśmy w pełnym środowisku portalu |
| Podgląd scalonej listy: CSV (RFC 4180), GeoJSON, JSON-LD, metadane CSVW | działa |
| Panel administratora (`/admin`): zatwierdzanie i odrzucanie zgłoszeń z kreatora i pojedynczych urządzeń (z ostrzeżeniem, gdy urządzenie wygląda na już znane), decyzje w Radarze; cofnięcie zatwierdzonego pojedynczego urządzenia przez API (`DELETE /admin/aed/{id}/user-report`) | działa; API w testach, w przeglądarce sprawdzona lista zgłoszeń, odmowa przy złym tokenie i zatwierdzenie pojedynczego urządzenia |
| Raport jakości dla każdego dostawcy | działa |
| Mapa z listą najbliższych urządzeń, strona wzorca, strona źródeł | działa; obejrzane na zrzutach ekranu w szerokości komputera i telefonu. W przeglądarce bez WebGL2 zamiast mapy jest komunikat, a lista działa dalej |
| Strona „O projekcie” (`/o-projekcie`, link w menu i w stopce): czym jest Mapa serc, liczby z `/v1/stats` na dziś, wejście do każdej części serwisu, jak to działa w trzech krokach. Strona główna (`/`) zostaje mapą, bo w nagłym wypadku liczy się czas | działa; obejrzana w szerokości komputera i telefonu, axe-core bez błędów, także z A++ i wysokim kontrastem |
| Link do aplikacji mobilnej: przycisk z ikoną telefonu w nagłówku i sekcja „Mapa serc w telefonie” na stronie „O projekcie” | czeka na adres aplikacji: wpisz go w `MOBILE_APP_URL` w `apps/web/lib/brand.ts`. Dopóki stała jest pusta, link się nie pokazuje. Z wpisanym adresem testowym sprawdzony w przeglądarce; menu w nagłówku mieści się w jednym rzędzie od 1200 px, węższe ekrany mają przycisk „Menu” |
| Dostępność (WCAG 2.2 AA, strona `/dostepnosc`): przycisk „Dostępność” w nagłówku z wielkością tekstu (A, A+, A++) i wysokim kontrastem (biały i żółty na czarnym), zapamiętany w przeglądarce i nakładany przed pierwszym wyświetleniem strony; obsługa klawiaturą, mapa z klawiatury z widocznym fokusem i opisem klawiszy dla czytnika ekranu, większy kontrast z ustawień systemu (`prefers-contrast`), tryb dużego kontrastu Windows (`forced-colors`), mniej ruchu (`prefers-reduced-motion`), na mapie znaczki ✕ i ? obok koloru, strona mapy przewija się w całości przy powiększeniu | działa; axe-core (WCAG 2.2 A/AA) bez błędów na każdej stronie w szerokości komputera i telefonu, także z A++ i wysokim kontrastem naraz, przejście Tabem przez każdą stronę, emulacja większego kontrastu, trybu dużego kontrastu i powiększenia 200% i 400%. Nie sprawdzaliśmy z prawdziwym czytnikiem ekranu |
| Droga pieszo do defibrylatora na mapie „Znajdź AED": po podaniu położenia mapa obraca się i pochyla tak, żeby urządzenie było przed użytkownikiem, a „Prowadź mnie" prowadzi krok po kroku jak nawigacja (najbliższy zakręt i odległość do niego, następny manewr, ile zostało, strzałka w miejscu użytkownika, nowa droga po zejściu z trasy, cała droga jako lista). Trasę i zakręty wyznacza publiczny router OSRM (FOSSGIS) na danych OpenStreetMap | działa; sprawdzone w przeglądarce z podstawionym położeniem, na komputerze i w szerokości telefonu. Nie sprawdzaliśmy tego w terenie, z prawdziwym GPS-em w telefonie |
| Trasa w 3D („Zobacz trasę w 3D” obok „Prowadź mnie”): pełnoekranowy podgląd drogi do defibrylatora, zanim będzie potrzebna. Kamera schodzi z widoku całej trasy za postać, która sama idzie trasą między bryłami budynków z OpenStreetMap, z tym samym banerem zakrętów co w prowadzeniu. Na końcu kamera wznosi się nad dachy i okrąża budynek z urządzeniem, a karta końcowa włącza prawdziwe prowadzenie. Można wstrzymać, przewinąć suwakiem, skakać po zakrętach, ustawić prędkość postaci (od marszu po przewijanie, z prędkościomierzem w km/h) i rozglądać się, przeciągając widok. Przy włączonym ograniczeniu ruchu w systemie nic nie rusza się samo. Ta sama mapa MapLibre, bez nowych bibliotek i usług | działa; sprawdzone w przeglądarce (Chromium z programowym WebGL) w szerokości komputera i telefonu, z podstawionym położeniem w Warszawie. Płynności na słabszych telefonach nie mierzyliśmy |
| Kreator dla dostawcy: plik Excela (.xlsx albo starszy .xls), CSV lub GeoJSON w dowolnym układzie, automatyczne dopasowanie kolumn, podgląd poprawek i duplikatów, zgłoszenie, zatwierdzenie przez operatora | działa w API (testy); interfejs zbudowany, nie był jeszcze sprawdzany w przeglądarce |
| Zgłoszenie jednego urządzenia przez każdego, bez logowania (`/dostawca` → „Jeden defibrylator”, link „Brakuje defibrylatora? Dodaj go” na mapie): pinezka na mapie, wyszukiwanie adresu w rejestrze adresów GUGiK albo własne położenie, ostrzeżenie o znanym urządzeniu w promieniu 50 m, kilka pól. Po zatwierdzeniu urządzenie jest oficjalne i trafia do wspólnego źródła „Mapa serc (zgłoszenia użytkowników)” z własnym plikiem XML dla dane.gov.pl. Dane instytucji mają pierwszeństwo: zgłoszenie tylko uzupełnia ich puste pola, a urządzenie znane wyłącznie z OpenStreetMap staje się oficjalne z wartościami ze zgłoszenia. Kto zaznaczy, że opiekuje się urządzeniem, i poda e-mail, dostaje naklejkę i link do panelu, ale tylko gdy urządzenie jest nowe i nie ma jeszcze opiekuna. Limity: 10 czekających zgłoszeń dziennie od jednej osoby, 60 wyszukiwań adresu na 10 minut | działa; API w testach, w przeglądarce przeklikane zgłoszenie, zatwierdzenie i cofnięcie, w szerokości komputera i telefonu, także bez WebGL; bez captchy |
| Kreator: podanie adresu istniejącego zbioru | do zrobienia |
| Radar AED: wskazówki z mapy społeczności (gminy i operatorzy) i z ogłoszeń o zakupach publicznych, decyzja operatora, link zaproszenia dla opiekuna, publikacja zgłoszenia z zaproszenia | działa w API (testy); interfejs zbudowany, nie był jeszcze sprawdzany w przeglądarce |
| Radar: klasyfikacja ogłoszeń modelem językowym, wskazówki ze stron gmin i BIP | do zrobienia; dziś ogłoszenia odsiewa filtr słów kluczowych |
| Źródło: Warszawa, 708 urządzeń z API miasta. Klucz (`WARSAW_API_KEY`) jest potrzebny tylko do pobrania świeżej listy; bez niego czytana jest kopia dołączona do repozytorium | działa |
| Łączenie rekordów po numerze urządzenia zapisanym w innym źródle (OpenStreetMap podaje numer z API Warszawy) | działa |
| „Gdzie brakuje AED" (`/braki`, `/v1/gaps`): mieszkańcy ze spisu 2021 w sześciokątach H3 na tle godzin tygodnia, w których sprawny defibrylator jest w zasięgu 400 m (bez przeterminowanych elektrod i baterii i bez zgłoszonych przez przechodniów jako brakujące); mapa luk, na której sześciokąty maleją z przybliżaniem (od ok. 250 km² dla całego kraju do 0,1 km² na ulicach; pięć poziomów H3 liczonych raz dla kraju i doczytywanych kafelkami), obszar zaznaczany prostokątem, lassem albo jako cała gmina (granice z ULDK, także wyszukiwana po nazwie miejscowości), panel z wnioskami, liczbami i 10 najlepszymi miejscami na nowe urządzenie, raport miejsca z gotowym uzasadnieniem do wniosku (druk do PDF, CSV) | działa; sprawdzone w przeglądarce na komputerze i telefonie |
| Budynek-gospodarz z OpenStreetMap przy polecanym miejscu (szkoła, urząd, apteka) i ruch dzienny (dworce, galerie) w liczeniu potrzeb | do zrobienia |

Logowanie przez mObywatel w wersji docelowej to login.gov.pl (Węzeł Krajowy): serwis przekierowuje tam opiekuna, a z powrotem dostaje podpisane potwierdzenie z imieniem, nazwiskiem i numerem PESEL. Przyłączenie serwisu wymaga testów na środowisku integracyjnym, wniosku i zgody ministra właściwego do spraw informatyzacji ([gov.pl/web/login/dla-integratorow](https://www.gov.pl/web/login/dla-integratorow)), dlatego w prototypie tę wymianę zastępuje ekran pokazowy. Kod za nim jest ten sam, który obsłuży prawdziwe logowanie (`apps/api/src/auth/identity.ts`): z tożsamości zapisujemy imię, pierwszą literę nazwiska i skrót identyfikatora, nigdy sam PESEL.

Zgłoszenie wysłane z kreatora bez tokenu operatora ma stan „oczekuje": dostawca widzi wynik, ale rekordy wchodzą do plików dla portalu dopiero po zatwierdzeniu (`POST /admin/sources/{id}/approve`). Niezatwierdzone zgłoszenie nie może też zmienić rekordów już opublikowanych. W wersji docelowej token operatora zastępuje tożsamość dostawcy z login.gov.pl. Zgłoszenie jednego urządzenia z formularza czeka w osobnej kolejce (`GET /admin/device-submissions`): do zatwierdzenia nie ma go na mapie ani w plikach, a adres e-mail opiekuna znika z kolejki razem z decyzją.

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
pnpm tunnel                 # nieobowiązkowe: publiczne adresy https strony i API (Cloudflare), np. do pokazania na telefonie
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
apps/web/          Next.js: mapa z listą, kreator, wzorzec, źródła i jakość, Radar, mapa luk, panel administratora
portal/            zmiana w kodzie portalu dane.gov.pl: wykazy zbiorcze, pierwszy to wykaz AED
zgloszenie/        pliki do zgłoszenia: wzorzec danych w XLSX, przykładowy plik urzędu do kreatora
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

Za dane w portalu odpowiada ten, kto je publikuje. Dlatego nie wystawiamy jednego zbioru krajowego pod jednym dostawcą. Każdy dostawca dostaje własne pliki:

- `/v1/sources/{id}/aed.csv`: jego urządzenia we wzorcu danych,
- `/feeds/dostawcy/{id}/dane-gov-pl.xml`: plik dla harvestera portalu (schemat 1.13) z jednym zbiorem tego dostawcy, tagiem `wykaz-aed` i zasobem CSV.

Portal nie ma publicznego API zapisu. Dostawca rejestruje w portalu adres pliku XML jako źródło swojej instytucji albo wgrywa CSV w panelu i dodaje tag `wykaz-aed`. Pliki ma tylko źródło zatwierdzone, z licencją z listy portalu (CC0 1.0, CC BY 4.0); OpenStreetMap ich nie ma. Linki są na stronie „Skąd te dane”, w ostatnim kroku kreatora i w panelu administratora po zatwierdzeniu.

Zbiory z tagiem `wykaz-aed` portal co noc scala w „Wykaz defibrylatorów AED – wykaz zbiorczy”. To robi zmiana w kodzie portalu opisana w [portal/README.md](portal/README.md). Pliki `/dane/aed.*` pokazują, jak taka scalona lista wygląda dziś.

Schemat portalu przyjmuje wyłącznie adresy `https`, więc plik XML jest poprawny dopiero na wdrożeniu z ustawionym `PUBLIC_API_URL`. Lokalnie plik zawiera komentarz z tym ostrzeżeniem.

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

[compose.yaml](compose.yaml) opisuje obie usługi dla Coolify (zasób typu Docker Compose). Oba obrazy zbudowaliśmy i uruchomiliśmy 22.11.2026 (podman): API startuje na czystej bazie, a strona odpowiada na wszystkich podstronach.

Kroki na Coolify:

1. Wypchnij repozytorium na GitHub. Coolify buduje obrazy z repozytorium.
2. Dodaj w Coolify zasób „Docker Compose” z tego repozytorium, z plikiem `compose.yaml`.
3. Ustaw domeny usług. Port po dwukropku mówi proxy Coolify, do którego portu kontenera kierować ruch:
   - `api`: `https://api.twoja-domena.pl:8787`,
   - `web`: `https://twoja-domena.pl:3000`.
4. Ustaw zmienne:
   - `PUBLIC_API_URL=https://api.twoja-domena.pl`,
   - `PUBLIC_WEB_URL=https://twoja-domena.pl`,
   - `ADMIN_TOKEN` i `LINK_SECRET` jako losowe ciągi (`openssl rand -hex 24`).

   `PUBLIC_API_URL` trafia do kodu strony przy budowaniu, więc po jego zmianie trzeba zbudować stronę od nowa.
5. Wdróż. Pierwszy start buduje zbiór z kopii plików dołączonych do repozytorium.
6. Uzupełnij dane. Na czystej bazie 708 urządzeń Warszawy ląduje w „do uzupełnienia”, bo nie mają kodów gmin. Kody ustala się z rejestru ULDK (GUGiK), który po serii szybkich zapytań blokuje adres na około godzinę. Najprościej przenieść bazę z komputera, na którym wszystko jest już policzone (kody gmin, warstwa OpenStreetMap, Radar):

   ```bash
   # na komputerze: zatrzymaj API (Ctrl+C przy pnpm dev:api), żeby baza była zapisana w całości i nie było obok pliku aed.duckdb.wal
   scp data/aed.duckdb serwer:/tmp/
   # na serwerze: nazwa kontenera API z `docker ps`
   docker stop <kontener-api>
   docker cp /tmp/aed.duckdb <kontener-api>:/data/aed.duckdb
   docker run --rm --volumes-from <kontener-api> -u root node:24-bookworm-slim chown -R node:node /data
   docker start <kontener-api>
   ```

   Druga droga to uruchomienie zadań na serwerze z własnego komputera. Trwa dłużej, ULDK może po drodze zablokować serwer, a na czystym serwerze tej drogi nie sprawdzaliśmy:

   ```bash
   API_URL=https://api.twoja-domena.pl ADMIN_TOKEN=… pnpm job pipeline --refresh
   API_URL=https://api.twoja-domena.pl ADMIN_TOKEN=… pnpm job enrich-osm
   API_URL=https://api.twoja-domena.pl ADMIN_TOKEN=… pnpm job radar
   ```
7. Sprawdź wynik:
   - `https://api.twoja-domena.pl/health` ma pokazywać 782 urządzenia w `official`,
   - `https://api.twoja-domena.pl/feeds/dostawcy/um-warszawa/dane-gov-pl.xml` ma się otworzyć bez komentarza o braku https,
   - `https://twoja-domena.pl/admin` ma przyjąć token.
8. Wpisz adres strony na górze [INSTRUKCJA-DLA-JURY.md](INSTRUKCJA-DLA-JURY.md), a token administratora w opis zgłoszenia.

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

Opis użycia narzędzi AI jest w zgłoszeniu na platformie HackNation.
