"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { FormEvent, useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import { createZone, getUser } from "@/lib/api";
import type { AdminSelection } from "@/lib/types";

const AdminAreaMapSelector = dynamic(() => import("@/components/AdminAreaMapSelector"), { ssr: false });

export default function NewZonePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selections, setSelections] = useState<AdminSelection[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const autoName = useMemo(() => {
    if (selections.length === 0) return "";
    const first = selections[0];
    if (first.parish) return first.parish;
    if (first.municipality) return first.municipality;
    if (first.district) return first.district;
    return "Portugal";
  }, [selections]);

  useEffect(() => {
    async function load() {
      try {
        const user = await getUser();
        if (!user) {
          window.location.href = "/auth";
          return;
        }
        setUserId(user.id);
      } catch {
        window.location.href = "/auth";
      } finally {
        setLoading(false);
      }
    }

    load().catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    if (selections.length === 0) {
      setError("Add at least one selected area.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createZone({
        user_id: userId,
        name: name.trim() || autoName,
        zone_type: "admin",
        center_lat: null,
        center_lng: null,
        radius_meters: null,
        admin_codes: {
          country: "PT",
          selections,
        },
        filters: { property_type: "apartment" },
        is_active: true,
      });
      window.location.href = `/zones/${created.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create zone.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <h1 className="page-title">Create zone (Portugal map)</h1>
        <p className="muted-text">Choose country, district, municipality, and parish. Stop at any step and add multiple areas.</p>

        <form onSubmit={onSubmit} className="stack">
          <label className="field">
            <span className="field-label">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={autoName || "Zone name"} />
          </label>
          {!loading && <AdminAreaMapSelector value={selections} onChange={setSelections} />}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={saving || !userId}>
              {saving ? "Saving..." : "Save zone"}
            </button>
            <Link href="/zones">Cancel</Link>
          </div>
        </form>
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
