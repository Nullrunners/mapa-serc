import type { Metadata } from "next";
import { Suspense } from "react";
import OwnerPanel from "@/components/owner-panel";

export const metadata: Metadata = { title: "Raport defibrylatora: panel opiekuna", robots: { index: false } };

/** Which device, and how the keeper got in, is in the address, known only in the browser. */
export default function OwnerPage() {
  return (
    <Suspense fallback={<p className="text-muted">Wczytuję…</p>}>
      <OwnerPanel />
    </Suspense>
  );
}
