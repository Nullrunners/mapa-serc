"use client";

import Link from "next/link";
import { LoadStatus, Stats } from "@/components/ui";
import { api } from "@/lib/api/client";
import { count } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

/** How many devices the dataset knows today, for the page "O projekcie". */
export default function LandingStats() {
  const result = useLoad("landing-stats", async (signal) => {
    const { data } = await api.GET("/v1/stats", { signal });
    if (!data) throw new Error("Nie udało się pobrać liczb. Spróbuj ponownie za chwilę.");
    return data;
  });

  return (
    <section aria-labelledby="liczby" className="space-y-4">
      <h2 id="liczby" className="text-xl font-bold">
        Ile defibrylatorów znamy
      </h2>
      {result.state === "ready" ? (
        <Stats
          className="sm:grid-cols-3"
          items={[
            { label: "W danych urzędowych", value: count(result.data.official) },
            { label: "Jeszcze niepotwierdzone (OpenStreetMap)", value: count(result.data.community) },
            { label: "Gminy z danymi urzędowymi", value: `${count(result.data.communesWithOfficial)} z ${count(result.data.communesTotal)}` },
          ]}
        />
      ) : (
        <LoadStatus of={result} />
      )}
      <p>
        <Link href="/jakosc" className="link">
          Skąd te dane
        </Link>
      </p>
    </section>
  );
}
