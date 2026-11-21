import type { Metadata } from "next";
import Gaps from "@/components/gaps";

export const metadata: Metadata = { title: "Gdzie brakuje defibrylatorów" };

export default function GapsPage() {
  return (
    <Gaps title="Gdzie brakuje defibrylatorów" lead="Zobacz, kto nie ma defibrylatora w pobliżu i gdzie nowy pomoże najbardziej." />
  );
}
