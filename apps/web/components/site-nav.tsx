"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

const LINKS = [
  { href: "/", label: "Znajdź AED" },
  { href: "/braki", label: "Gdzie brakuje AED" },
  { href: "/radar", label: "Radar AED" },
  { href: "/jakosc", label: "Skąd te dane" },
  { href: "/wzorzec", label: "Wzorzec danych" },
] as const;

/** The navigation with the page the person is on marked. */
export function CurrentNav() {
  return <Nav current={usePathname()} />;
}

/**
 * Links to every part of the site, and the call to providers at the end. On a phone they fold under "Menu".
 * `current` is null while the address is not known yet (a page with a device number, before the browser takes over).
 */
export function Nav({ current }: { current: string | null }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const here = (href: string) => (current === href ? "page" : undefined);

  return (
    // Esc folds the menu on a phone and puts the keyboard back on its button.
    <nav
      aria-label="Główna nawigacja"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        close();
        toggle.current?.focus();
      }}
    >
      <button ref={toggle} type="button" aria-expanded={open} aria-controls="menu" onClick={() => setOpen(!open)} className="btn btn-secondary btn-sm lg:hidden">
        Menu
      </button>
      <ul
        id="menu"
        className={`${open ? "flex" : "hidden"} absolute inset-x-0 top-full z-30 flex-col gap-1 border-b border-line bg-white p-3 shadow-md lg:static lg:flex lg:flex-row lg:items-center lg:border-0 lg:p-0 lg:shadow-none`}
      >
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={here(link.href)}
              onClick={close}
              className="block rounded-md px-3 py-2 font-semibold text-ink/80 hover:bg-surface hover:text-gov aria-[current=page]:bg-gov-light aria-[current=page]:text-gov lg:text-sm"
            >
              {link.label}
            </Link>
          </li>
        ))}
        <li className="mt-2 lg:mt-0 lg:ml-3">
          <Link href="/dostawca" aria-current={here("/dostawca")} onClick={close} className="btn btn-primary btn-sm w-full">
            Zgłoś urządzenia
          </Link>
        </li>
      </ul>
    </nav>
  );
}
