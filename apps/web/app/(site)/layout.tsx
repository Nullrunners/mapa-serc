import type { ReactNode } from "react";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";

/** Pages to read and fill in: a column of comfortable width between the header and the footer. */
export default function SitePagesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="tresc" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
