/**
 * How the person wants the site shown: larger text and the high-contrast version (yellow on black). Kept in the
 * browser and set on <html> as `data-tekst` and `data-kontrast`; app/globals.css does the rest.
 *
 * The root layout runs SETTINGS_SCRIPT while the page is still being read, so a returning visitor never sees the
 * page in the wrong size or colours first.
 */

export const TEXT_SIZES = ["100", "125", "150"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface DisplaySettings {
  text: TextSize;
  contrast: boolean;
}

const KEY = "mapa-serc-wyglad";
const DEFAULT: DisplaySettings = { text: "100", contrast: false };

function parse(raw: string | null): DisplaySettings {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return {
      text: TEXT_SIZES.includes(value?.text) ? value.text : DEFAULT.text,
      contrast: value?.contrast === true,
    };
  } catch {
    return DEFAULT;
  }
}

/** Puts the settings on <html>, where the styles read them. */
export function applySettings(settings: DisplaySettings): void {
  const root = document.documentElement;
  if (settings.text === DEFAULT.text) delete root.dataset.tekst;
  else root.dataset.tekst = settings.text;
  if (settings.contrast) root.dataset.kontrast = "wysoki";
  else delete root.dataset.kontrast;
}

/** What readSettings and applySettings do, as a script for <head>: it runs before anything is painted. */
export const SETTINGS_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||"{}"),r=document.documentElement;if(${JSON.stringify(TEXT_SIZES.slice(1))}.indexOf(s.text)>=0)r.dataset.tekst=s.text;if(s.contrast===true)r.dataset.kontrast="wysoki"}catch(e){}})()`;

// A tiny store for useSyncExternalStore: the server and the first render see the defaults, then the saved choice.
let lastRaw: string | null | undefined;
let last: DisplaySettings = DEFAULT;
/** The choice made while the browser refuses storage (private mode): it holds until the page is closed. */
let unsaved: DisplaySettings | null = null;
const listeners = new Set<() => void>();

function storedRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function readSettings(): DisplaySettings {
  if (unsaved) return unsaved;
  const raw = storedRaw();
  if (raw !== lastRaw) {
    lastRaw = raw;
    last = parse(raw);
  }
  return last;
}

export const serverSettings = (): DisplaySettings => DEFAULT;

export function saveSettings(settings: DisplaySettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    unsaved = null;
  } catch {
    unsaved = settings;
  }
  applySettings(settings);
  for (const listener of listeners) listener();
}

/** Also follows a change made in another tab. */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    applySettings(readSettings());
    listener();
  };
  window.addEventListener("storage", fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromOtherTab);
  };
}
