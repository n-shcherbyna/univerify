"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/issuer", label: "Issuer" },
  { href: "/verifier", label: "Verifier" },
  { href: "/revoke", label: "Revoke" },
  { href: "/admin", label: "Admin" },
] as const;

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="uv-nav-wrap">
      <nav className="uv-nav">
        <Link href="/" className="uv-nav-brand">
          UV
        </Link>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "uv-nav-link uv-nav-link-active" : "uv-nav-link"}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
