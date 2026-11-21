"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadStatus, PageHeader, TONE_TEXT } from "@/components/ui";
import { date } from "@/lib/format";
import { api } from "@/lib/api/client";
import { REPORT_TEXT, expiryText, partName, type PassportPublic } from "@/lib/passport-text";
import { clearSession, loadAccount, loadLoginOptions, loginHref, sessionHeader, type KeeperAccount } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/** Who is logged in, with the way out. `children` are links that belong next to the name. */
export function KeeperBar({ name, onLogout, children }: { name: string; onLogout: () => void; children?: React.ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
      <span>
        Zalogowano przez mObywatel jako <strong>{name}</strong>
      </span>
      {children}
      <button
        type="button"
        onClick={() => {
          clearSession();
          onLogout();
        }}
        className="link"
      >
        Wyloguj
      </button>
    </p>
  );
}

/** The keeper's start page: the devices of the logged-in person, or how to get in. */
export default function KeeperHome() {
  const [loggedOut, setLoggedOut] = useState(false);
  const [changed, setAccount] = useState<KeeperAccount | null>(null);
  const loaded = useLoad("keeper-home", async (signal) => {
    const [account, login] = await Promise.all([loadAccount(signal), loadLoginOptions(signal)]);
    return { account, login };
  });
  const account = loaded.state === "ready" && !loggedOut ? (changed ?? loaded.data.account) : null;

  async function remove(id: string) {
    const { data } = await api.POST("/v1/account/devices/{id}/remove", { params: { path: { id }, header: { "x-keeper-session": sessionHeader()["x-keeper-session"] ?? "" } } }).catch(() => ({ data: undefined }));
    if (data) setAccount(data);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Panel opiekuna" lead="Tu zajmujesz się swoimi defibrylatorami: wpisujesz terminy ważności elektrod i baterii i potwierdzasz, że urządzenie działa." />
      <div aria-live="polite">
        <LoadStatus of={loaded} />
      </div>

      {loaded.state === "ready" && !account && (
        <div className="space-y-3">
          {loaded.data.login.mode !== "off" && (
            <Link href={loginHref("/opiekun")} className="btn btn-primary">
              Zaloguj się przez mObywatel
            </Link>
          )}
          <p className="text-sm">
            Pierwszy raz? Otwórz link, który wysłaliśmy na adres Twojej instytucji. Nie masz go? Zeskanuj kod QR z naklejki przy urządzeniu albo znajdź je na mapie i na jego stronie poproś o nowy link.
          </p>
        </div>
      )}

      {account && (
        <>
          <KeeperBar name={account.name} onLogout={() => setLoggedOut(true)} />
          {account.devices.length === 0 ? (
            <p>
              Przy Twoim koncie nie ma jeszcze żadnego urządzenia. Otwórz link, który wysłaliśmy na adres Twojej instytucji, i w panelu urządzenia kliknij „Dodaj do mojego konta”. Potem wejdziesz już
              bez linku.
            </p>
          ) : (
            <section aria-labelledby="moje-naglowek" className="space-y-2">
              <h2 id="moje-naglowek" className="text-lg font-bold">
                Moje defibrylatory
              </h2>
              <ul className="divide-y divide-line border-y border-line">
                {account.devices.map((device) => (
                  <Device key={device.id} device={device} onRemove={() => remove(device.id)} />
                ))}
              </ul>
              <p className="hint">Urządzenie usunięte z konta zostaje w bazie. Wrócisz do niego linkiem z wiadomości od nas.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Device({ device, onRemove }: { device: PassportPublic; onRemove: () => void }) {
  const due = device.items.filter((item) => item.state === "expired" || item.state === "soon");
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="space-y-0.5 text-sm">
        <p className="text-base font-semibold">{device.name}</p>
        <p className="text-muted">{device.confirmedAt ? `Sprawność potwierdzona ${date(device.confirmedAt)}` : "Bez potwierdzenia sprawności"}</p>
        {device.reports.problems.map((problem) => (
          <p key={problem.kind} className="font-semibold text-danger">
            Zgłoszono: {REPORT_TEXT[problem.kind]}
          </p>
        ))}
        {due.map((item) => {
          const expiry = expiryText(item);
          return (
            <p key={item.item} className={TONE_TEXT[expiry.tone]}>
              {partName(item)}: {expiry.text}
            </p>
          );
        })}
      </div>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/opiekun?id=${device.id}`} className="btn btn-secondary btn-sm">
          Otwórz panel
        </Link>
        <button type="button" onClick={onRemove} className="link text-sm">
          Usuń z konta<span className="sr-only">: {device.name}</span>
        </button>
      </span>
    </li>
  );
}
