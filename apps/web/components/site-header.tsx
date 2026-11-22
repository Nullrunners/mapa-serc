import Link from "next/link";
import { Suspense } from "react";
import DisplaySettings from "@/components/display-settings";
import { LogoMark } from "@/components/logo";
import { CurrentNav, Nav } from "@/components/site-nav";
import { BRAND, MOBILE_APP_URL } from "@/lib/brand";

/** `wide` spans the whole screen, like the full-screen map under it; otherwise it lines up with the page column. */
export default function SiteHeader({ wide = false }: { wide?: boolean }) {
  return (
    <header className="relative shrink-0 border-b border-line bg-white print:hidden">
      {/* The menu and the display settings open under this row. With larger text on a phone the buttons may not
          fit beside the name: then they move to a second row. */}
      <div className={`relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 ${wide ? "lg:px-6" : "mx-auto max-w-6xl"}`}>
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-md">
          <LogoMark className="size-9" />
          <span className="leading-tight">
            <span className="block text-lg font-bold text-gov">{BRAND.name}</span>
            <span className="block text-xs text-muted">{BRAND.slogan}</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 lg:gap-3">
          {/* On a page with a device number the address is known only in the browser; until then no link is marked. */}
          <Suspense fallback={<Nav current={null} />}>
            <CurrentNav />
          </Suspense>
          {MOBILE_APP_URL && <AppLink />}
          <DisplaySettings wide={wide} />
        </div>
      </div>
    </header>
  );
}

/** The mobile app, beside "Dostępność" and shown the same way: the word drops to an icon where the row is tight. */
function AppLink() {
  return (
    <a href={MOBILE_APP_URL} target="_blank" rel="noopener noreferrer" title="Aplikacja mobilna" className="btn btn-secondary btn-sm">
      <PhoneIcon />
      <span className="sr-only sm:not-sr-only lg:sr-only 2xl:not-sr-only">Aplikacja</span>
      <span className="sr-only"> mobilna (otworzy się w nowej karcie)</span>
    </a>
  );
}

export function PhoneIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}
