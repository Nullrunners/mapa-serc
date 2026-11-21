import type { ReactNode } from "react";
import SiteHeader from "@/components/site-header";

/**
 * Pages that are a map: exactly one screen tall, the map fills everything under the header and only the panel
 * next to it scrolls. On paper (the report of a place) the page flows normally again.
 */
export default function MapPagesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col print:block print:h-auto">
      <SiteHeader wide />
      <main id="tresc" className="flex min-h-0 flex-1 flex-col print:block">
        {children}
      </main>
    </div>
  );
}
