"use client";

import { api, type AedItem } from "@/lib/api/client";
import StickerFace from "@/components/sticker-face";
import { passportHref } from "@/lib/passport-text";
import { useLoad } from "@/lib/use-load";

/**
 * A 10 × 10 cm sticker for the cabinet, printed on a page of its own size.
 * The same address can be written to an NFC tag, so a phone held to the sticker opens the same page.
 */
export default function Sticker({ id }: { id: string }) {
  const url = useLoad(`url|${id}`, async () => passportHref(id));
  const loaded = useLoad(id, async (signal) => {
    const { data } = await api.GET("/v1/aed/{id}", { params: { path: { id } }, signal });
    if (!data) throw new Error("Nie znamy defibrylatora o tym numerze.");
    return data as AedItem;
  });

  return (
    <div className="space-y-6 print:space-y-0">
      <style>{`
        @page { size: 100mm 100mm; margin: 0; }
        @media print { main { padding: 0 !important; max-width: none !important; } }
      `}</style>

      <div className="max-w-2xl space-y-2 print:hidden">
        <h1 className="text-2xl font-bold">Naklejka na defibrylator</h1>
        <p className="text-muted">
          Wydrukuj naklejkę i przyklej ją na szafce albo obok urządzenia. Kto zeskanuje kod telefonem, zobaczy paszport urządzenia i jednym kliknięciem potwierdzi, że defibrylator jest na miejscu, albo zgłosi
          problem. Zgłoszenie trafi do Ciebie.
        </p>
        <button type="button" onClick={() => window.print()} className="rounded bg-gov px-4 py-2 font-semibold text-white hover:bg-gov-dark">
          Drukuj naklejkę
        </button>
        {loaded.state === "error" && (
          <p role="alert" className="text-danger">
            {loaded.message}
          </p>
        )}
      </div>

      {/* 10 cm is wider than a phone screen; the preview scrolls instead of the page. */}
      <div className="overflow-x-auto print:overflow-visible">
        <StickerFace id={id} aed={loaded.state === "ready" ? loaded.data : null} />
      </div>

      <div className="max-w-2xl space-y-1 text-sm text-muted print:hidden">
        {url.state === "ready" && (
          <p>
            Adres w kodzie: <span className="break-all font-mono">{url.data}</span>
          </p>
        )}
        <p>Ten sam adres możesz zapisać na naklejce NFC. Wtedy wystarczy przyłożyć telefon do naklejki, żeby otworzyć paszport.</p>
      </div>
    </div>
  );
}
