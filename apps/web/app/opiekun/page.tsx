import type { Metadata } from "next";
import OwnerPanel from "@/components/owner-panel";

export const metadata: Metadata = { title: "Paszport defibrylatora: panel opiekuna", robots: { index: false } };

export default function OwnerPage() {
  return <OwnerPanel />;
}
