import Link from "next/link";
import { Suspense } from "react";
import DisplaySettings from "@/components/display-settings";
import { LogoMark } from "@/components/logo";
import { CurrentNav, Nav } from "@/components/site-nav";
import { BRAND } from "@/lib/brand";

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
          <DisplaySettings wide={wide} />
        </div>
      </div>
    </header>
  );
}
