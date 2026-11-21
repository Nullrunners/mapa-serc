"use client";

import StickerFace from "@/components/sticker-face";
import { LoadStatus, PageHeader, PrintSetup } from "@/components/ui";
import { api, type AedItem } from "@/lib/api/client";
import { STICKERS_PER_PAGE, STICKERS_PER_SHEET } from "@/lib/passport-text";
import { useLoad } from "@/lib/use-load";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Several stickers on A4 pages, four to a page, with dashed lines to cut along. Devices come from `?id=a,b,c`. */
export default function StickerSheet() {
  const loaded = useLoad("sheet", async (signal) => {
    const asked = [...new Set((new URLSearchParams(window.location.search).get("id") ?? "").split(",").map((id) => id.trim().toLowerCase()))].filter((id) => ID.test(id));
    if (asked.length === 0) throw new Error("W adresie nie ma numerów urządzeń. Otwórz link z kreatora albo z wiadomości od nas jeszcze raz.");
    const ids = asked.slice(0, STICKERS_PER_SHEET);
    const found = await Promise.all(ids.map(async (id) => ({ id, aed: ((await api.GET("/v1/aed/{id}", { params: { path: { id } }, signal })).data as AedItem | undefined) ?? null })));
    return { devices: found.filter((entry) => entry.aed !== null), unknown: found.filter((entry) => entry.aed === null).length, cut: asked.length - ids.length };
  });

  if (loaded.state !== "ready") {
    return (
      <div aria-live="polite" className="max-w-2xl">
        <LoadStatus of={loaded} />
      </div>
    );
  }

  const { devices, unknown, cut } = loaded.data;
  const pages: (typeof devices)[] = [];
  for (let start = 0; start < devices.length; start += STICKERS_PER_PAGE) pages.push(devices.slice(start, start + STICKERS_PER_PAGE));

  return (
    <div className="space-y-6 print:space-y-0">
      <PrintSetup page="size: A4; margin: 4mm;" />

      <div className="max-w-2xl space-y-4 print:hidden">
        <PageHeader title="Naklejki na defibrylatory" lead="Cztery na kartce A4. Drukuj w skali 100%, wytnij po liniach i sprawdź nazwę pod kodem." />
        <button type="button" onClick={() => window.print()} className="btn btn-primary">
          Drukuj naklejki ({devices.length})
        </button>
        {unknown > 0 && <p className="text-warn">Nie znamy {unknown === 1 ? "jednego urządzenia" : `${unknown} urządzeń`} z tego linku, więc pominęliśmy ich naklejki.</p>}
        {cut > 0 && (
          <p className="text-warn">
            Najwyżej {STICKERS_PER_SHEET} naklejek naraz. Pozostałe {cut} wydrukujesz z kolejnego linku.
          </p>
        )}
      </div>

      {pages.map((page, index) => (
        <div key={index} className="grid w-fit grid-cols-2 not-last:break-after-page print:break-inside-avoid">
          {page.map(({ id, aed }) => (
            <div key={id} className="border border-dashed border-muted">
              <StickerFace id={id} aed={aed} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
