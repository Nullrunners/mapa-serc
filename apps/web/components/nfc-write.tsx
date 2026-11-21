"use client";

import { useState } from "react";
import { LiveMessage, type Message } from "@/components/ui";
import { useLoad } from "@/lib/use-load";

/** Web NFC writer (Chrome on Android, https only). TypeScript's DOM library does not describe it. */
interface NdefWriter {
  write(message: { records: { recordType: "url"; data: string }[] }, options?: { signal?: AbortSignal }): Promise<void>;
}

const ndefReader = () => (window as unknown as { NDEFReader?: new () => NdefWriter }).NDEFReader;

/** How long the phone waits for a tag before giving up. */
const WAIT_MS = 30_000;

/**
 * Writes the passport address to an NFC sticker, so a phone held to it opens the same page as the QR code.
 * Only Chrome on Android can write NFC from a web page; elsewhere the address can be copied into an NFC app.
 */
export default function NfcWrite({ url }: { url: string }) {
  const support = useLoad("nfc", async () => typeof ndefReader() === "function" && window.isSecureContext);
  const canWrite = support.state === "ready" && support.data;
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  async function write() {
    const Reader = ndefReader();
    if (!Reader) return;
    setBusy(true);
    setMessage({ text: "Przyłóż naklejkę NFC do tyłu telefonu i przytrzymaj chwilę.", tone: "plain" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WAIT_MS);
    try {
      await new Reader().write({ records: [{ recordType: "url", data: url }] }, { signal: controller.signal });
      setMessage({ text: "Zapisane. Przyłóż telefon do naklejki jeszcze raz i sprawdź, czy otwiera się paszport.", tone: "ok" });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setMessage({
        text:
          name === "NotAllowedError"
            ? "Telefon nie pozwolił na zapis. Zezwól tej stronie na używanie NFC i spróbuj jeszcze raz."
            : name === "AbortError"
              ? "Nie wykryliśmy naklejki przez 30 sekund. Spróbuj jeszcze raz."
              : "Nie udało się zapisać naklejki. Sprawdź, czy NFC w telefonie jest włączone i czy naklejka nie jest zablokowana przed zapisem.",
        tone: "danger",
      });
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ text: "Skopiowaliśmy adres. Wklej go w aplikacji do zapisywania naklejek NFC.", tone: "ok" });
    } catch {
      setMessage({ text: "Nie udało się skopiować. Zaznacz adres powyżej i skopiuj go ręcznie.", tone: "danger" });
    }
  }

  return (
    <section aria-labelledby="nfc-naglowek" className="space-y-3">
      <h2 id="nfc-naglowek" className="text-base font-bold">
        Naklejka NFC
      </h2>
      <p className="text-muted">Ten sam adres możesz zapisać na naklejce NFC. Wtedy wystarczy przyłożyć telefon do naklejki, żeby otworzyć paszport.</p>
      {!canWrite && <p className="text-muted">Zapis prosto z tej strony działa w przeglądarce Chrome na telefonie z Androidem. Na innym urządzeniu skopiuj adres i zapisz go w aplikacji do naklejek NFC.</p>}
      <div className="flex flex-wrap gap-2">
        {canWrite && (
          <button type="button" disabled={busy} onClick={write} className="btn btn-primary">
            Zapisz adres na naklejce NFC
          </button>
        )}
        <button type="button" onClick={copy} className="btn btn-secondary">
          Skopiuj adres
        </button>
      </div>
      <LiveMessage message={message} />
    </section>
  );
}
