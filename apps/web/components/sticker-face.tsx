"use client";

import QRCode from "qrcode";
import type { AedItem } from "@/lib/api/client";
import { LogoMark } from "@/components/logo";
import { addressLine, title } from "@/lib/aed-text";
import { BRAND } from "@/lib/brand";
import { passportHref, shortCode } from "@/lib/passport-text";
import { useLoad } from "@/lib/use-load";

/**
 * One 10 × 10 cm sticker for the cabinet: QR code to the device passport, short code, the emergency number and the
 * campaign mark. The address is taken from the page itself, so a sticker printed from the deployment points at the
 * deployment. `aed` adds the name and address line once it has loaded.
 */
export default function StickerFace({ id, aed }: { id: string; aed: AedItem | null }) {
  const qr = useLoad(`qr|${id}`, async () => {
    const url = passportHref(id);
    return { url, svg: await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#1b1b1b", light: "#ffffff" } }) };
  });
  const url = qr.state === "ready" ? qr.data.url : null;
  const svg = qr.state === "ready" ? qr.data.svg : null;

  return (
    <figure
      aria-label={aed ? `Naklejka: ${title(aed)}` : "Podgląd naklejki"}
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
      {aed && (
        <p className="truncate px-[4mm] text-[2.8mm] text-muted">
          {title(aed)}
          {addressLine(aed) ? `, ${addressLine(aed)}` : ""}
        </p>
      )}
      <div className="mt-[2mm] flex items-center justify-between border-t-2 border-danger px-[4mm] py-[2mm]">
        <span className="text-[4.2mm] font-extrabold text-danger">Nagły wypadek? Dzwoń 112</span>
        <span className="flex items-center gap-[1.5mm]">
          <LogoMark className="h-[7mm] w-[7mm]" />
          <span className="text-[3mm] font-bold leading-tight text-gov">
            {BRAND.name}
            <span className="block text-[2.4mm] font-semibold text-muted">{BRAND.slogan}</span>
          </span>
        </span>
      </div>
    </figure>
  );
}
