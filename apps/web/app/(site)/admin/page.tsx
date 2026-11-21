import type { Metadata } from "next";
import Candidates from "@/components/candidates";
import { PageHeader } from "@/components/ui";

// Not linked from the menu and kept out of search engines: only the operator who knows the address and the token uses it.
export const metadata: Metadata = { title: "Panel administratora", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Panel administratora" lead="Decyzje w Radarze AED: poproś opiekuna o potwierdzenie urządzenia albo odrzuć wskazówkę." />
      <Candidates admin />
    </div>
  );
}
