import type { Metadata } from "next";
import { Suspense } from "react";
import SubmitEntry from "@/components/submit-entry";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Zgłoś urządzenia" };

/** One device on a map or a list from a file; which one is in the address, known only in the browser. */
export default function ProviderPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Zgłoś defibrylatory" />
      <Suspense fallback={<p className="text-muted">Wczytuję…</p>}>
        <SubmitEntry />
      </Suspense>
    </div>
  );
}
