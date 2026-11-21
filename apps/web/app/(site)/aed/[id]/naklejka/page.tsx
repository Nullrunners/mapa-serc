import type { Metadata } from "next";
import { Suspense } from "react";
import Sticker from "@/components/sticker";

export const metadata: Metadata = { title: "Naklejka na defibrylator" };

export default function StickerPage({ params }: PageProps<"/aed/[id]/naklejka">) {
  return (
    <Suspense fallback={<p className="text-muted">Wczytuję…</p>}>
      <StickerFor params={params} />
    </Suspense>
  );
}

async function StickerFor({ params }: Pick<PageProps<"/aed/[id]/naklejka">, "params">) {
  const { id } = await params;
  return <Sticker id={id} />;
}
