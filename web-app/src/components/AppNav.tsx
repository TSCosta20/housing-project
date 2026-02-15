"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/zones", label: "Zones" },
  { href: "/listings", label: "Listings" },
  { href: "/settings/alerts", label: "Alert Settings" },
];

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignOut() {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      router.push("/auth");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign out failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <nav className="app-nav">
      <div className="app-nav-links">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`app-nav-link ${pathname?.startsWith(link.href) ? "active-link" : ""}`}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <button className="btn btn-subtle" onClick={onSignOut} disabled={busy}>
        {busy ? "Signing out..." : "Sign out"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </nav>
  );
}
