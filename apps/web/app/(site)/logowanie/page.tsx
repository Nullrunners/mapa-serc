import type { Metadata } from "next";
import { Suspense } from "react";
import Login from "@/components/login";

export const metadata: Metadata = { title: "Logowanie przez mObywatel", robots: { index: false } };

/** Where to come back to is in the address, known only in the browser; the boundary lets the rest render first. */
export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-muted">Wczytuję…</p>}>
      <Login />
    </Suspense>
  );
}
