"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { completeAuthFromCallback } from "@/lib/api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    completeAuthFromCallback(url)
      .then(() => router.replace("/zones"))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Magic link failed.");
      });
  }, [router]);

  return (
    <main className="page-wrap">
      <section className="card stack">
        <h1>Signing you in...</h1>
        {error ? (
          <>
            <p className="error-text">{error}</p>
            <a href="/auth">Back to login</a>
          </>
        ) : (
          <p className="muted-text">Please wait while we complete authentication.</p>
        )}
      </section>
    </main>
  );
}
