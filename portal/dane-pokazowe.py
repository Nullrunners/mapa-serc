"""
Dane pokazowe dla lokalnego portalu: instytucje dostawców, kategorie i źródła harvestera, które wskazują
na pliki XML z Mapy serc. Uruchomienie (API Mapy serc musi działać pod adresem z MAPA_SERC_URL):

    podman exec -i mcod-admin python manage.py shell < portal/dane-pokazowe.py

Skrypt można uruchamiać wiele razy. Zakłada tylko to, czego brakuje, a na końcu zleca import ze źródeł
(tak jak nocne zadanie harvestera). Zasilenie ręczne, czyli plik dodany w panelu, opisuje portal/README.md.
"""

import os

from django.apps import apps

from mcod.harvester.tasks import import_data_task

Organization = apps.get_model("organizations", "Organization")
Category = apps.get_model("categories", "Category")
User = apps.get_model("users", "User")
DataSource = apps.get_model("harvester", "DataSource")

MAPA_SERC_URL = os.environ.get("MAPA_SERC_URL", "https://mapa-serc.mcod.local").rstrip("/")
admin = User.objects.get(email="admin@mcod.local")

# Właściciel wykazu zbiorczego (AGGREGATED_LISTS_OWNER_ORGANIZATION_PK, domyślnie 2844 jak dla wykazu DGA).
INSTITUTIONS = [
    # pk, nazwa, slug, miejscowość, rodzaj, identyfikator źródła w Mapie serc (None: bez harvestera)
    (2844, "Ministerstwo Cyfryzacji", "ministerstwo-cyfryzacji", "Warszawa", "state", None),
    (2901, "Urząd m.st. Warszawy", "urzad-m-st-warszawy", "Warszawa", "local", "um-warszawa"),
    (2902, "Urząd Miasta Krosna", "urzad-miasta-krosna", "Krosno", "local", "dane-gov-pl-54632"),
    (2903, "Urząd Miasta Marki", "urzad-miasta-marki", "Marki", "local", "dane-gov-pl-68353"),
    (2904, "Urząd Miejski w Przemyślu", "urzad-miejski-w-przemyslu", "Przemyśl", "local", "dane-gov-pl-62093"),
    # Legionowo dodaje swój plik ręcznie w panelu, dlatego nie ma źródła harvestera.
    (2905, "Urząd Miasta Legionowo", "urzad-miasta-legionowo", "Legionowo", "local", None),
]
CATEGORIES = [("HEAL", "Zdrowie"), ("REGI", "Regiony i miasta")]

for code, title in CATEGORIES:
    category, created = Category.objects.get_or_create(
        code=code, defaults={"title": title, "description": "", "status": "published", "created_by": admin}
    )
    print("kategoria", code, "założona" if created else "jest")

sources = []
for pk, title, slug, city, institution_type, source_id in INSTITUTIONS:
    institution = Organization.raw.filter(pk=pk).first()
    if institution is None:
        institution = Organization.objects.create(
            pk=pk,
            title=title,
            slug=slug,
            description=f"<p>{title}: instytucja z danych pokazowych lokalnego portalu.</p>",
            institution_type=institution_type,
            postal_code="00-001",
            city=city,
            street_type="ul.",
            street="Przykładowa",
            street_number="1",
            email="kontakt@example.org",
            regon="000000000",
            tel="0048220000000",
            website="https://example.org",
            abbreviation="",
            status="published",
            created_by=admin,
            modified_by=admin,
        )
        print("instytucja", pk, title, "założona")
    if source_id is None:
        continue
    xml_url = f"{MAPA_SERC_URL}/feeds/dostawcy/{source_id}/dane-gov-pl.xml"
    source, created = DataSource.objects.get_or_create(
        xml_url=xml_url,
        defaults={
            "name": f"Mapa serc – {title}",
            "description": f"<p>Defibrylatory AED, które zgłasza {title}. Plik XML przygotowuje Mapa serc.</p>",
            "frequency_in_days": 1,
            "status": "active",
            "source_type": "xml",
            "institution_type": institution_type,
            "emails": "admin@mcod.local",
            "organization": institution,
            "created_by": admin,
            "modified_by": admin,
        },
    )
    sources.append(source)
    print("źródło harvestera", source.pk, xml_url, "założone" if created else "jest")

for source in sources:
    import_data_task.s(source.pk, force=True).apply_async()
    print("zlecono import ze źródła", source.pk)
