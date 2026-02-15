"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AppNav from "@/components/AppNav";
import { deactivateZone, getSession, listZones, normalizeAdminSelections } from "@/lib/api";
import type { Zone } from "@/lib/types";

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function adminSummary(zone: Zone): string {
    const selections = normalizeAdminSelections(zone.admin_codes?.["selections"]);
    if (selections.length > 0) {
      const first = selections[0];
      const firstLabel = first.parish ?? first.municipality ?? first.district ?? "Portugal";
      return selections.length === 1 ? `Area: ${firstLabel}` : `${selections.length} areas selected`;
    }
    const legacyParish = zone.admin_codes?.["parish"];
    return typeof legacyParish === "string" && legacyParish ? `Parish: ${legacyParish}` : "Area: -";
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const session = await getSession();
      if (!session) {
        window.location.href = "/auth";
        return;
      }
      const result = await listZones();
      setZones(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zones.");
    } finally {
      setLoading(false);
    }
  }

  async function onDeactivate(zoneId: string) {
    setError(null);
    try {
      await deactivateZone(zoneId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deactivate failed.");
    }
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <div className="row space-between">
          <h1 className="page-title">Zones</h1>
          <Link href="/zones/new">Create zone</Link>
          <button className="btn" onClick={() => refresh()} disabled={loading}>
            Refresh
          </button>
        </div>

        {loading && <p className="muted-text">Loading zones...</p>}
        {!loading && zones.length === 0 && <p className="muted-text">No active zones yet.</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="list-grid">
          {zones.map((zone) => (
            <article key={zone.id} className="card stack">
              <div className="row space-between">
                <strong>{zone.name}</strong>
                <span className="badge">{zone.zone_type}</span>
              </div>
              <p className="muted-text">
                {zone.zone_type === "admin"
                  ? adminSummary(zone)
                  : `Radius: ${zone.radius_meters ?? "-"}m`}
              </p>
              <div className="row">
                <Link href={`/zones/${zone.id}`}>Open dashboard</Link>
                <button className="btn btn-danger" onClick={() => onDeactivate(zone.id)}>
                  Deactivate
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
