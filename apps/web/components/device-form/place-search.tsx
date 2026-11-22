"use client";

import { useState, type FormEvent } from "react";
import { LiveMessage, type Message } from "@/components/ui";
import { api, problemMessage } from "@/lib/api/client";
import type { Point } from "@/lib/route";

/**
 * Finds the place by its address in the state register, or takes the person's own position. The way in when the
 * map cannot be drawn, and the quick one when the person stands by the device.
 */
export default function PlaceSearch({ onFound }: { onFound: (point: Point) => void }) {
  const [town, setTown] = useState("");
  const [street, setStreet] = useState("");
  const [busy, setBusy] = useState<"search" | "locate" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function find(event: FormEvent) {
    event.preventDefault();
    // "Białe Błota, Szubińska 7": the form the address register answers best.
    const q = [town.trim(), street.trim()].filter(Boolean).join(", ");
    setBusy("search");
    setMessage(null);
    const { data, error } = await api.GET("/v1/geo/address", { params: { query: { q } } }).catch(() => ({ data: undefined, error: undefined }));
    setBusy(null);
    if (!data) return setMessage({ text: problemMessage(error, "Wyszukiwarka adresów chwilowo nie działa. Ustaw pinezkę na mapie."), tone: "danger" });
    if (!data.address) return setMessage({ text: "Nie znaleźliśmy tego adresu. Sprawdź pisownię albo ustaw pinezkę na mapie.", tone: "danger" });
    // The map goes there, and the address under it says what was found.
    onFound({ lat: data.address.lat, lon: data.address.lon });
  }

  function locate() {
    if (!("geolocation" in navigator)) return setMessage({ text: "Ta przeglądarka nie poda położenia. Wpisz adres.", tone: "danger" });
    setBusy("locate");
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(null);
        onFound({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => {
        setBusy(null);
        setMessage({ text: "Nie udało się ustalić położenia. Wpisz adres.", tone: "danger" });
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="space-y-3">
      <form onSubmit={find} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor="szukaj-miejscowosc" className="label text-sm">
            Miejscowość
          </label>
          <input id="szukaj-miejscowosc" required minLength={2} maxLength={60} autoComplete="address-level2" value={town} onChange={(event) => setTown(event.target.value)} className="field w-full" />
        </div>
        <div className="space-y-1">
          <label htmlFor="szukaj-ulica" className="label text-sm">
            Ulica i numer
          </label>
          <input id="szukaj-ulica" maxLength={60} autoComplete="address-line1" value={street} onChange={(event) => setStreet(event.target.value)} className="field w-full" />
        </div>
        <button type="submit" disabled={busy !== null} className="btn btn-secondary">
          {busy === "search" ? "Szukam…" : "Znajdź"}
        </button>
      </form>
      <button type="button" onClick={locate} disabled={busy !== null} className="btn btn-secondary btn-sm">
        {busy === "locate" ? "Ustalam położenie…" : "Użyj mojej lokalizacji"}
      </button>
      <LiveMessage message={message} className="text-sm" />
    </div>
  );
}
