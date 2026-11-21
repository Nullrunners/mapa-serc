import Link from "next/link";
import { Suspense } from "react";
import { LogoMark } from "@/components/logo";
import { CurrentNav, Nav } from "@/components/site-nav";
import { BRAND } from "@/lib/brand";

export default function SiteHeader() {
  return (
    <header className="relative border-b border-line bg-white print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-md">
          <LogoMark className="size-9" />
          <span className="leading-tight">
            <span className="block text-lg font-bold text-gov">{BRAND.name}</span>
            <span className="block text-xs text-muted">{BRAND.slogan}</span>
          </span>
        </Link>
        {/* On a page with a device number the address is known only in the browser; until then no link is marked. */}
        <Suspense fallback={<Nav current={null} />}>
          <CurrentNav />
        </Suspense>
      </div>
    </header>
  );
}
