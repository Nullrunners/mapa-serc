"use client";

import QRCode from "qrcode";
import { api, type AedItem } from "@/lib/api/client";
import { addressLine, title } from "@/lib/aed-text";
import { shortCode } from "@/lib/passport-text";
import { useLoad } from "@/lib/use-load";

/**
 * A 10 × 10 cm sticker for the cabinet: QR code to the device passport, short code and the emergency number.
 * The same address can be written to an NFC tag, so a phone held to the sticker opens the same page.
 */
export default function Sticker({ id }: { id: string }) {
  // The address is taken from the page itself, so a sticker printed from the deployment points at the deployment.
  const qr = useLoad(`qr|${id}`, async () => {
    const url = `${window.location.origin}/aed/${id}`;
    return { url, svg: await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#1b1b1b", light: "#ffffff" } }) };
  });
  const url = qr.state === "ready" ? qr.data.url : null;
  const svg = qr.state === "ready" ? qr.data.svg : null;

  const loaded = useLoad(id, async (signal) => {
    const { data } = await api.GET("/v1/aed/{id}", { params: { path: { id } }, signal });
    if (!data) throw new Error("Nie znamy defibrylatora o tym numerze.");
    return data as AedItem;
  });

  return (
    <div className="space-y-6">
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

      <figure
        aria-label="Podgląd naklejki"
        className="flex h-[100mm] w-[100mm] flex-col overflow-hidden rounded-lg border-2 border-ink bg-white text-ink print:rounded-none print:border-0"
      >
        <div className="flex items-center justify-between bg-ok px-[4mm] py-[2.5mm] text-white">
          <span className="text-[7mm] font-extrabold leading-none tracking-wide">AED</span>
          <span className="text-right text-[3mm] font-semibold leading-tight">
            Defibrylator
            <br />
            dostępny dla każdego
          </span>
        </div>
        <div className="flex flex-1 items-center gap-[4mm] px-[4mm] py-[3mm]">
          <div className="h-[46mm] w-[46mm] shrink-0" role="img" aria-label={url ? `Kod QR prowadzący do ${url}` : "Kod QR"} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
          <div className="space-y-[2mm] text-[3.2mm] leading-snug">
            <p className="font-bold">Zeskanuj telefonem</p>
            <p>Potwierdź, że urządzenie jest na miejscu, albo zgłoś problem.</p>
            <p className="font-mono text-[3mm]">Kod: {shortCode(id)}</p>
          </div>
        </div>
        {loaded.state === "ready" && (
          <p className="truncate px-[4mm] text-[2.8mm] text-muted">
            {title(loaded.data)}
            {addressLine(loaded.data) ? `, ${addressLine(loaded.data)}` : ""}
          </p>
        )}
        <div className="mt-[2mm] flex items-center justify-between border-t-2 border-danger px-[4mm] py-[2mm]">
          <span className="text-[4.2mm] font-extrabold text-danger">Nagły wypadek? Dzwoń 112</span>
          {/* Slot for the campaign logo; until it exists the service name stands in. */}
          <span className="text-[3mm] font-bold text-gov">AED Hub</span>
        </div>
      </figure>

      <div className="max-w-2xl space-y-1 text-sm text-muted print:hidden">
        {url && (
          <p>
            Adres w kodzie: <span className="break-all font-mono">{url}</span>
          </p>
        )}
        <p>Ten sam adres możesz zapisać na naklejce NFC. Wtedy wystarczy przyłożyć telefon do naklejki, żeby otworzyć paszport.</p>
      </div>
    </div>
  );
}
