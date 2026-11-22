# Wykazy zbiorcze w portalu dane.gov.pl

Ta zmiana w kodzie portalu dane.gov.pl składa jeden ogólnopolski wykaz defibrylatorów AED z danych, które publikują różni dysponenci (urzędy gmin, szpitale, firmy).

Każdy dysponent publikuje w portalu własne dane i sam za nie odpowiada. Portal co noc zbiera je w jedną tabelę. Przy każdym wierszu widać, kto go dostarczył i z którego zasobu pochodzi.

Zmiana uogólnia mechanizm, który portal już ma: zbiorczy „Wykaz chronionych danych” (DGA). Defibrylatory AED to pierwszy wykaz, a kolejne dodaje się bez pisania nowego kodu.

Plik ze zmianą: [mcod-backend.patch](mcod-backend.patch). Nakłada się go na backend portalu w wersji 2.62.3, czyli kod z [dane.gov.pl/source-code](https://dane.gov.pl/source-code/). Używaliśmy kopii z GitHuba: github.com/olekstomek/mcod-backend-dane.gov.pl, gałąź `backend_2.62.3`.

## Jak to działa

1. Dysponent publikuje w portalu zbiór danych z plikiem CSV, XLSX albo XLS. Plik ma kolumny [wzorca danych AED](../zgloszenie/wzorzec-danych-aed.xlsx). Może to zrobić w panelu administracyjnym albo przez harvester (import z pliku XML lub z CKAN).
2. Dysponent dodaje do zbioru tag `wykaz-aed`. Tagi są już w panelu i w obu harvesterach, więc nie trzeba zmieniać schematu XML.
3. Gdy dysponent dodaje plik w panelu, portal od razu sprawdza jego kolumny. Jeśli brakuje wymaganych, pokazuje komunikat, np. „Zbiór ma tag „wykaz-aed”, więc ten plik trafi do wykazu „Wykaz defibrylatorów AED – wykaz zbiorczy”. Brakuje w nim kolumn: id, kod_terc. Uzupełnij je według wzorca danych albo usuń tag ze zbioru.”
4. Co noc o 3:45, po harvesterach (3:00), portal zbiera opublikowane zasoby ze zbiorów z tagiem `wykaz-aed`. Bierze tylko te, które przeszły zwykłe sprawdzenie portalu: pliku, linku i danych. Tak samo robi wykaz DGA.
5. Portal sprawdza każdy plik:
   - plik bez wymaganych kolumn odpada w całości,
   - wiersz z pustym albo błędnym polem wymaganym odpada, a portal liczy, ile takich wierszy było i dlaczego,
   - wiersz z identyfikatorem, który ma już inny wiersz w wykazie, też odpada.
6. Do każdego wiersza portal dopisuje trzy kolumny:
   - `dysponent_danych`: nazwa instytucji, która opublikowała zasób. To ona odpowiada za ten wiersz.
   - `zasob_zrodlowy`: adres zasobu w portalu, z którego pochodzi wiersz.
   - `aktualizacja_zasobu_zrodlowego`: data danych tego zasobu.
7. Wynik trafia jako plik CSV do zasobu „Defibrylatory AED – wykaz zbiorczy (CSV)” w zbiorze „Wykaz defibrylatorów AED – wykaz zbiorczy” Ministerstwa Cyfryzacji. Za pierwszym razem portal zakłada zbiór i zasób. Potem tylko podmienia plik, więc adres zasobu się nie zmienia.
8. Portal sprawdza nowy plik tak jak każdy inny zasób. Jeśli plik nie przejdzie sprawdzenia, wraca poprzedni.
9. Raport z ostatniego przebiegu zostaje w bazie (tabela `AggregatedListInfo`). Widać w nim, które zasoby weszły do wykazu, które odpadły i dlaczego oraz ile wierszy pominięto.

Wykaz można też zbudować ręcznie, np. na pokazie. To polecenia dla programistów, uruchamiane w kontenerze portalu:

```bash
python manage.py build_aggregated_list aed --dry-run --output wykaz-aed.csv   # tylko plik i raport, bez zmian w portalu
python manage.py build_aggregated_list aed                                    # zbuduj i opublikuj, jak nocne zadanie
```

## Na czym się wzorowaliśmy: wykaz chronionych danych (DGA)

Portal już dziś składa jeden wykaz z zasobów wielu instytucji: „Wykaz zasobów chronionych danych DGA – raport zbiorczy”. Kod jest w `mcod/resources/dga_utils.py` i `mcod/resources/tasks/dga.py`. Nasza zmiana robi to samo, ale nie tylko dla jednego wykazu. Kodu DGA nie zmienialiśmy.

| | Wykaz DGA (dziś) | Wykazy zbiorcze (ta zmiana) |
|---|---|---|
| Jak zasób trafia do wykazu | flaga „zawiera chronione dane” przy zasobie | tag wykazu przy zbiorze, np. `wykaz-aed` |
| Kolumny | stała lista w kodzie (`dga_constants.py`) | wzorzec danych w pliku Table Schema (`schemas/aed.json`) |
| Ile wykazów | jeden | dowolnie wiele, każdy opisany w jednym miejscu (`definitions.py`) |
| Kto odpowiada za wiersz | kolumna „Nazwa dysponenta zasobu” | `dysponent_danych`, a do tego adres i data zasobu źródłowego |
| Wynik | XLSX | CSV (UTF-8, RFC 4180), czytelny dla programów |
| Zasób z wynikiem | co noc nowy, stary jest usuwany | ten sam zasób, podmieniany plik, stały adres |
| Pora | 3:30 | 3:45 |

## Jak dysponent dołącza do wykazu AED

- Do zbioru dodaje tag `wykaz-aed`.
- Publikuje plik CSV, XLSX albo XLS z kolumnami wzorca danych AED (34 kolumny, opis w [zgloszenie/wzorzec-danych-aed.xlsx](../zgloszenie/wzorzec-danych-aed.xlsx)). Wielkość liter i spacje w nagłówkach nie mają znaczenia. Kolumny spoza wzorca portal pomija, a brakujące kolumny niewymagane zostawia puste.
- Wymaganych jest 10 kolumn: `id`, `nazwa`, `miejscowosc`, `kod_terc`, `szerokosc_geograficzna`, `dlugosc_geograficzna`, `status`, `zrodlo`, `licencja`, `data_aktualizacji`.
- W tych kolumnach portal sprawdza wartości:
  - `id`: identyfikator UUID,
  - `kod_terc`: 7 cyfr; zera z przodu, które zgubił arkusz, portal dopisuje sam,
  - współrzędne: stopnie w układzie WGS84, w granicach Polski; przecinek dziesiętny jest dozwolony,
  - `status` i `licencja`: wartości z listy we wzorcu,
  - `data_aktualizacji`: format RRRR-MM-DD.
- Kreator Mapy serc przygotowuje taki plik z dowolnego arkusza urzędu.

## Co zmienia się w kodzie portalu

Ta część jest dla programistów.

| Plik | Co robi | Na co patrzeć |
|---|---|---|
| `mcod/resources/aggregated_lists/definitions.py` (nowy) | rejestr wykazów i definicja wykazu AED: tag, tytuły i opisy zbioru i zasobu, kategorie, właściciel | `AED`, `REGISTRY`; zbiór zbiorczy nie może mieć tagu, z którego sam powstaje (`__post_init__`) |
| `mcod/resources/aggregated_lists/schemas/aed.json` (nowy) | wzorzec danych AED jako Frictionless Table Schema (kopia `/dane/schema.json` z API Mapy serc) | `constraints.required`, `primaryKey: id` |
| `mcod/resources/aggregated_lists/core.py` (nowy) | odczyt pliku, sprawdzenie kolumn i wartości, scalanie, zapis CSV; bez Django, więc da się to testować osobno | reguły w opisie na początku pliku, `merge_tables`, kolumny dysponenta `PROVIDER_COLUMNS` |
| `mcod/resources/aggregated_lists/service.py` (nowy) | część portalowa: wybór zasobów, utworzenie zbioru i zasobu, podmiana pliku, wycofanie zmiany | `get_source_resources`, `publish`, `roll_back` |
| `mcod/resources/tasks/aggregated_lists.py` (nowy) | zadania Celery: wszystkie wykazy, jeden wykaz, oczekiwanie na walidację z ponawianiem | `check_aggregated_list_task` działa jak sprawdzanie walidacji w zadaniu DGA |
| `mcod/resources/management/commands/build_aggregated_list.py` (nowy) | ręczne zbudowanie wykazu, także bez publikacji (`--dry-run`) | |
| `mcod/resources/models.py` | model `AggregatedListInfo`: jeden wiersz na wykaz, wskazuje zbiór i zasób z wynikiem i trzyma raport ostatniego przebiegu | odpowiednik `AggregatedDGAInfo` |
| `mcod/resources/migrations/0075_aggregatedlistinfo.py` (nowy) | tabela dla `AggregatedListInfo` | napisana ręcznie w kształcie z `makemigrations` |
| `mcod/resources/forms.py` | sprawdzenie kolumn przy dodawaniu pliku do zbioru z tagiem wykazu, komunikat po polsku | `_validate_aggregated_list_file` |
| `mcod/celeryapp.py` | nocne uruchomienie o 3:45 | `aggregated_lists_creation` |
| `mcod/settings/base.py` | właściciel zbiorów zbiorczych (domyślnie ten sam co dla DGA), adres powiadomień, kolejki zadań | `AGGREGATED_LISTS_*` |
| `mcod/resources/tests/test_aggregated_lists_core.py` (nowy) | 14 testów rdzenia | |

### Kolejny wykaz

Wystarczą dwie rzeczy: plik Table Schema w `schemas/` i nowy wpis `AggregatedListDefinition` w `definitions.py` (slug, tag, plik wzorca, tytuły). Nocne zadanie samo zbuduje wszystkie wykazy z rejestru. Tak można by zebrać np. rzeczy znalezione, o których portal ma dziś 387 osobnych zbiorów.

Gdy zmieni się wzorzec danych AED, plik `schemas/aed.json` podmienia się nową wersją z `/dane/schema.json` (API Mapy serc) i odtwarza łatkę (`git diff`).

## Nałożenie zmiany i testy

Polecenia dla programistów, z katalogu głównego repozytorium Mapy serc:

```bash
portal/apply-patch.sh            # pobiera kod portalu do portal/mcod-backend i nakłada zmianę
portal/run-tests.sh              # to samo, a potem uruchamia testy rdzenia
```

Testy potrzebują tylko Pythona z pakietami pandas, openpyxl, pytest i django. Nie potrzebują bazy danych ani reszty portalu. Bez takiego Pythona skrypt użyje Nixa, jeśli jest zainstalowany. Wynik z 22.11.2026: `14 passed`.

Ręcznie, w katalogu portalu z nałożoną zmianą:

```bash
python -m pytest -o addopts= --noconftest -p no:cacheprovider mcod/resources/tests/test_aggregated_lists_core.py
```

W pełnym środowisku portalu (Docker, `docker-compose.yml` z repozytorium portalu) po nałożeniu zmiany trzeba jeszcze wykonać migrację:

```bash
python manage.py migrate resources
```

## Ograniczenia

- **Części portalowej nie uruchomiliśmy w działającym portalu.** Na komputerze, na którym powstała zmiana, nie było Dockera, a portal potrzebuje m.in. PostgreSQL, Elasticsearcha, RabbitMQ i Celery. Nieuruchomione są: `service.py`, zadania Celery, polecenie `build_aggregated_list`, sprawdzenie w formularzu i migracja. Ten kod trzyma się możliwie blisko działającego kodu wykazu DGA.
- Sprawdziliśmy:
  - 14 testów rdzenia,
  - przebieg rdzenia na prawdziwych danych: 782 urządzenia z pliku krajowego Mapy serc podzielone na 5 dysponentów; wszystkie wiersze przeszły sprawdzenie, a w wyniku każdy ma swojego dysponenta,
  - poprawność składni wszystkich zmienionych plików,
  - nałożenie łatki na czystą gałąź `backend_2.62.3` (`git apply --check`).
- Tag `wykaz-aed` może dodać każdy dysponent. Przed złymi danymi chroni sprawdzenie kolumn i wartości, a każdy wiersz jest podpisany przez swojego dysponenta. Jeśli to za mało, można dopuścić tylko wybrane rodzaje instytucji, tak jak DGA (`ALLOWED_DGA_INSTITUTIONS`).
- Duplikaty portal rozpoznaje tylko po identyfikatorze (`id`). To samo urządzenie opublikowane przez dwóch dysponentów pod różnymi identyfikatorami pojawi się dwa razy. Mapa serc łączy takie duplikaty, zanim dysponent opublikuje plik.
- Wartości kolumn niewymaganych przechodzą bez sprawdzania.
- Strona portalu (frontend) się nie zmienia: wykaz jest zwykłym zasobem. Mapę w podglądzie danych ustawia się raz w panelu (rola kolumn: szerokość, długość, etykieta). Nie sprawdzaliśmy, czy to ustawienie przetrwa nocną podmianę pliku.
