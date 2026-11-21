import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";
import type { Loaded } from "@/lib/use-load";

/** Small pieces every page is built from. Buttons, fields and links are plain classes in app/globals.css. */

export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-muted", plain: "text-ink" };

/** The title of a page and a sentence or two about what it is for. */
export function PageHeader({ title, lead, children, className = "" }: { title: ReactNode; lead?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`max-w-3xl space-y-2 ${className}`}>
      <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
      {lead && <p className="text-muted">{lead}</p>}
      {children}
    </div>
  );
}

/** "Wczytuję…" while the data is on its way, the reason when it failed, nothing once it is there. */
export function LoadStatus({ of: loaded }: { of: Loaded<unknown> }) {
  if (loaded.state === "loading") return <p className="text-muted">Wczytuję…</p>;
  if (loaded.state === "error")
    return (
      <p role="alert" className="text-danger">
        {loaded.message}
      </p>
    );
  return null;
}

/** A few numbers side by side, each under the words that say what it counts. */
export function Stats({ items, className = "" }: { items: { label: string; value: ReactNode; note?: ReactNode }[]; className?: string }) {
  return (
    <dl className={`grid gap-3 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-surface px-4 py-3">
          <dt className="text-sm text-muted">{item.label}</dt>
          <dd className="text-xl font-bold tabular-nums">{item.value}</dd>
          {item.note && <dd className="text-sm text-muted">{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A state in a few words with a dot of its colour; the words carry the meaning, the colour only helps. */
export function Status({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <p className={`flex items-start gap-2 font-semibold ${TONE_TEXT[tone]} ${className}`}>
      <span aria-hidden className="mt-[0.5em] size-2 shrink-0 rounded-full bg-current" />
      <span>{children}</span>
    </p>
  );
}

export interface Message {
  text: string;
  tone: Tone;
}

/** The answer to what the person just did. The region is always there, so a screen reader announces every new message. */
export function LiveMessage({ message, className = "" }: { message: Message | null; className?: string }) {
  return (
    <p aria-live="polite" className={`font-semibold ${message ? TONE_TEXT[message.tone] : ""} ${className}`}>
      {message?.text}
    </p>
  );
}

/** Back to the list a panel took the place of. */
export function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-semibold text-gov hover:underline print:hidden">
      <span aria-hidden>← </span>
      {children}
    </button>
  );
}

/** Paper size and margins for printing this page (CSS `@page`); on paper the page's own padding goes away. */
export function PrintSetup({ page }: { page: string }) {
  return <style>{`@page { ${page} } @media print { main { padding: 0 !important; max-width: none !important; } }`}</style>;
}

/** A link that opens in a new tab, and says so to screen readers. */
export function ExternalLink({ href, className = "link", children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (otworzy się w nowej karcie)</span>
    </a>
  );
}
