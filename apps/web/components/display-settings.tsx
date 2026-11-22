"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { applySettings, readSettings, saveSettings, serverSettings, subscribeSettings, TEXT_SIZES, type TextSize } from "@/lib/display-settings";

/** Each size is shown as a letter of that size; a screen reader says it in words. */
const SIZES: Record<TextSize, { shown: string; said: string; className: string }> = {
  "100": { shown: "A", said: "zwykły", className: "text-sm" },
  "125": { shown: "A+", said: "większy", className: "text-base" },
  "150": { shown: "A++", said: "największy", className: "text-lg" },
};

/**
 * "Dostępność" in the header, shown as the icon alone at every width (the word stays for screen readers and as the
 * tooltip): larger text and the high-contrast version, remembered in this browser. The panel opens
 * under the header row at its right edge (`wide`: the header's wider side padding), wherever the button itself has
 * wrapped to, and folds away on Esc, on a click elsewhere and when the keyboard leaves it.
 */
export default function DisplaySettings({ wide = false }: { wide?: boolean }) {
  const settings = useSyncExternalStore(subscribeSettings, readSettings, serverSettings);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // In development React clears what the script in <head> put on <html> when it mounts the page again.
  useLayoutEffect(() => applySettings(readSettings()), []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      ref={box}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button ref={button} type="button" aria-expanded={open} aria-controls="wyglad" title="Dostępność" onClick={() => setOpen(!open)} className="btn btn-secondary btn-sm">
        <AccessIcon />
        <span className="sr-only">Dostępność</span>
      </button>

      <div
        id="wyglad"
        hidden={!open}
        className={`absolute top-full right-4 z-40 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-lg border border-field bg-white p-4 text-left shadow-lg ${wide ? "lg:right-6" : ""}`}
      >
        <fieldset className="space-y-2">
          <legend className="label text-sm">Wielkość tekstu</legend>
          <div className="flex flex-wrap gap-2">
            {TEXT_SIZES.map((size) => (
              <label key={size} className="chip min-w-12 justify-center">
                <input type="radio" name="wielkosc-tekstu" checked={settings.text === size} onChange={() => saveSettings({ ...settings, text: size })} className="sr-only" />
                <span aria-hidden className={SIZES[size].className}>
                  {SIZES[size].shown}
                </span>
                <span className="sr-only">{SIZES[size].said}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="label text-sm">Kontrast</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                [false, "Zwykły"],
                [true, "Wysoki"],
              ] as const
            ).map(([contrast, label]) => (
              <label key={label} className="chip">
                <input type="radio" name="kontrast" checked={settings.contrast === contrast} onChange={() => saveSettings({ ...settings, contrast })} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <Link href="/dostepnosc" onClick={() => setOpen(false)} className="link block text-sm">
          Więcej o dostępności
        </Link>
      </div>
    </div>
  );
}

/** The usual sign for accessibility: a figure with open arms in a circle. */
function AccessIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="7" r="1.25" fill="currentColor" stroke="none" />
      <path d="M7.5 9.75 12 11l4.5-1.25M12 11v3m0 0-2.5 4.5M12 14l2.5 4.5" />
    </svg>
  );
}
