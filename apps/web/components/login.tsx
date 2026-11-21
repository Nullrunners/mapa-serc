"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LiveMessage, LoadStatus, PageHeader, type Message } from "@/components/ui";
import { api, problemMessage } from "@/lib/api/client";
import { loadLoginOptions, safeReturn, saveSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * Logging in "with mObywatel". The real thing is a trip to login.gov.pl and back; this prototype has a stand-in,
 * where the person picks one of a few made-up people. The page says so plainly and asks for no personal data.
 */
export default function Login() {
  const router = useRouter();
  const back = safeReturn(useSearchParams().get("powrot"));
  const loaded = useLoad("login", loadLoginOptions);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function enter(person: string) {
    setBusy(true);
    setMessage(null);
    const { data, error } = await api.POST("/v1/auth/login/demo", { body: { person } }).catch(() => ({ data: undefined, error: undefined }));
    if (!data) {
      setBusy(false);
      return setMessage({ text: problemMessage(error, "Nie udało się zalogować. Spróbuj ponownie za chwilę."), tone: "danger" });
    }
    saveSession(data.session);
    router.replace(back);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Zaloguj się przez mObywatel"
        lead="Po zalogowaniu wejdziesz do panelu opiekuna bez szukania linku w poczcie. Przy potwierdzeniu sprawności będzie też widać, że zrobiła to zalogowana osoba."
      />
      <div aria-live="polite">
        <LoadStatus of={loaded} />
      </div>

      {loaded.state === "ready" && loaded.data.mode === "off" && (
        <div className="space-y-3">
          <p>W tym serwisie logowanie przez mObywatel nie jest włączone. Do panelu opiekuna wejdziesz linkiem, który wysyłamy e-mailem ze strony urządzenia.</p>
          <Link href="/" className="link">
            Znajdź swoje urządzenie na mapie
          </Link>
        </div>
      )}

      {loaded.state === "ready" && loaded.data.mode === "demo" && (
        <>
          <div className="space-y-2 rounded-lg border-2 border-warn p-4">
            <p className="font-semibold">To logowanie pokazowe.</p>
            <p className="text-sm">
              W działającym serwisie otworzy się tu strona login.gov.pl, a Ty potwierdzisz logowanie w aplikacji mObywatel. Tutaj wybierasz jedną z przykładowych osób. Każdy może wybrać tę samą, więc
              to logowanie niczego nie chroni.
            </p>
          </div>
          <ul className="space-y-2">
            {loaded.data.people.map((person) => (
              <li key={person.id}>
                <button type="button" disabled={busy} onClick={() => enter(person.id)} className="btn btn-secondary w-full justify-start py-3 text-left sm:w-auto">
                  Wejdź jako {person.name}
                </button>
              </li>
            ))}
          </ul>
          <LiveMessage message={message} />
          <p className="hint">Zapisujemy tylko imię i pierwszą literę nazwiska, żeby inni opiekunowie tego samego urządzenia wiedzieli, kto je sprawdzał.</p>
        </>
      )}
    </div>
  );
}
