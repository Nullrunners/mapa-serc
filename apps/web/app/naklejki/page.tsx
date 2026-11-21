import type { Metadata } from "next";
import StickerSheet from "@/components/sticker-sheet";

export const metadata: Metadata = { title: "Naklejki na defibrylatory", robots: { index: false } };

export default function StickerSheetPage() {
  return <StickerSheet />;
}
