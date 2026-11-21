import type { Metadata } from "next";
import { Suspense } from "react";
import Passport from "@/components/passport";

export const metadata: Metadata = { title: "Raport defibrylatora" };

/** The id is known only per request; the boundary lets the rest of the page render before it is read. */
export default function PassportPage({ params }: PageProps<"/aed/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Wczytuję…</p>}>
      <PassportFor params={params} />
    </Suspense>
  );
}

async function PassportFor({ params }: Pick<PageProps<"/aed/[id]">, "params">) {
  const { id } = await params;
  return <Passport id={id} />;
}
