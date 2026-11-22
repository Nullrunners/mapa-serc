import type { ReactNode } from "react";
import SiteHeader from "@/components/site-header";

/**
 * Pages that are a map: exactly one screen tall, the map fills everything under the header and only the panel
 * next to it scrolls. On a very short screen (a phone held sideways, a page zoomed to 200% or more) that would leave
 * a sliver for each, so the page keeps a minimum height and scrolls as a whole. On paper (the report of a place)
 * the page flows normally again.
 */
export default function MapPagesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-h-[36rem] flex-col print:block print:h-auto print:min-h-0">
      <SiteHeader wide />
      <main id="tresc" className="flex min-h-0 flex-1 flex-col print:block">
        {children}
      </main>
    </div>
  );
}
