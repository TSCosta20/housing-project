"use client";

import { FormEvent, useEffect, useState } from "react";

import AppNav from "@/components/AppNav";
import { getProfile, getUser, upsertProfile } from "@/lib/api";
import type { AlertChannel } from "@/lib/types";

const DEFAULT_SUBJECT = "Offer for your listing";
const DEFAULT_BODY = "Hello, I want to make an offer.";

export default function AlertSettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [channel, setChannel] = useState<AlertChannel>("both");
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const user = await getUser();
        if (!user) {
          window.location.href = "/auth";
          return;
        }
        setUserId(user.id);

        const profile = await getProfile(user.id);
        if (profile) {
          setChannel(profile.default_alert_channel);
          setSubject(profile.email_template_subject ?? DEFAULT_SUBJECT);
          setBody(profile.email_template_body ?? DEFAULT_BODY);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load alert settings.");
      } finally {
        setLoading(false);
      }
    }

    load().catch(() => undefined);
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await upsertProfile({
        user_id: userId,
        name: null,
        default_alert_channel: channel,
        email_template_subject: subject,
        email_template_body: body,
      });
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <h1 className="page-title">Alert settings</h1>
        {loading && <p className="muted-text">Loading settings...</p>}
        {!loading && (
          <form onSubmit={onSave} className="stack">
            <label className="field">
              <span className="field-label">Alert channel</span>
              <select value={channel} onChange={(event) => setChannel(event.target.value as AlertChannel)}>
                <option value="push">push</option>
                <option value="email">email</option>
                <option value="both">both</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Email subject</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Email body</span>
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} />
            </label>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </form>
        )}
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
