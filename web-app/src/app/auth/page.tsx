"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { getSession, sendMagicLink, signInWithPassword, signUpWithPassword } from "@/lib/api";

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((session) => {
        if (session) {
          router.replace("/zones");
        }
      })
      .catch(() => undefined);
  }, [router]);

  async function runAction(fn: () => Promise<void>, okMessage?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      if (okMessage) {
        setMessage(okMessage);
      } else {
        router.push("/zones");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onPasswordLogin(event: FormEvent) {
    event.preventDefault();
    await runAction(() => signInWithPassword(email, password));
  }

  async function onPasswordSignUp() {
    await runAction(() => signUpWithPassword(email, password), "Account created. You can now sign in.");
  }

  async function onMagicLink() {
    await runAction(
      () => sendMagicLink(email, window.location.origin),
      "Magic link sent. Check your email.",
    );
  }

  return (
    <main className="page-wrap">
      <section className="card stack">
        <h1 className="page-title">Welcome back</h1>
        <p className="muted-text">Use password login or send a magic link.</p>

        <form onSubmit={onPasswordLogin} className="stack">
          <label className="field">
            <span className="field-label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Working..." : "Login with password"}
            </button>
            <button className="btn" type="button" onClick={onPasswordSignUp} disabled={busy}>
              Register with password
            </button>
            <button className="btn" type="button" onClick={onMagicLink} disabled={busy}>
              Send magic link
            </button>
          </div>
        </form>

        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
