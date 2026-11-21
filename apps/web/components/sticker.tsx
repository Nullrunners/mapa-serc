"use client";

import NfcWrite from "@/components/nfc-write";
import StickerFace from "@/components/sticker-face";
import { PageHeader, PrintSetup } from "@/components/ui";
import { api, type AedItem } from "@/lib/api/client";
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
      <PrintSetup page="size: 100mm 100mm; margin: 0;" />

      <div className="max-w-2xl space-y-4 print:hidden">
        <PageHeader title="Naklejka na defibrylator" lead="Przyklej przy urządzeniu. Po zeskanowaniu każdy potwierdzi, że jest na miejscu, albo zgłosi Ci problem." />
        <button type="button" onClick={() => window.print()} className="btn btn-primary">
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

      {url.state === "ready" && (
        <div className="max-w-2xl space-y-6 text-sm print:hidden">
          <p className="text-muted">
            Adres w kodzie: <span className="font-mono break-all text-ink">{url.data}</span>
          </p>
          <NfcWrite url={url.data} />
        </div>
      )}
    </div>
  );
}
