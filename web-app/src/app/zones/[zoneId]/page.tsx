"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

import AppNav from "@/components/AppNav";
import SourceChip from "@/components/SourceChip";
import { getLatestZoneStats, getZone, getZoneDeals, normalizeAdminSelections, updateZone } from "@/lib/api";
import type { AdminSelection, ListingScoring, Zone, ZoneDailyStats } from "@/lib/types";

const AdminAreaMapSelector = dynamic(() => import("@/components/AdminAreaMapSelector"), { ssr: false });

export default function ZoneDashboardPage() {
  const params = useParams<{ zoneId: string }>();
  const zoneId = params.zoneId;

  const [zone, setZone] = useState<Zone | null>(null);
  const [stats, setStats] = useState<ZoneDailyStats | null>(null);
  const [deals, setDeals] = useState<ListingScoring[]>([]);
  const [name, setName] = useState("");
  const [radius, setRadius] = useState("");
  const [selections, setSelections] = useState<AdminSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [zoneResult, statsResult, dealsResult] = await Promise.all([
        getZone(zoneId),
        getLatestZoneStats(zoneId),
        getZoneDeals(zoneId),
      ]);
      setZone(zoneResult);
      setStats(statsResult);
      setDeals(dealsResult);
      if (zoneResult) {
        setName(zoneResult.name);
        setRadius(zoneResult.radius_meters ? String(zoneResult.radius_meters) : "");
        const adminCodes =
          zoneResult.admin_codes && typeof zoneResult.admin_codes === "object" ? zoneResult.admin_codes : null;
        const selectionRows = normalizeAdminSelections(adminCodes?.["selections"]);
        if (selectionRows.length > 0) {
          setSelections(selectionRows);
        } else {
          const legacyParishRaw = adminCodes ? adminCodes["parish"] ?? adminCodes["freguesia"] : "";
          const legacyParish = typeof legacyParishRaw === "string" ? legacyParishRaw.trim() : "";
          setSelections(legacyParish ? [{ country: "PT", parish: legacyParish }] : []);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zone dashboard.");
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const patch: Partial<Zone> = {
        name,
      };
      if (zone?.zone_type === "admin") {
        if (selections.length === 0) {
          throw new Error("Select at least one area.");
        }
        patch.admin_codes = {
          country: "PT",
          selections,
        };
      } else {
        patch.radius_meters = radius ? Number(radius) : null;
      }
      await updateZone(zoneId, patch);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save zone.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <div className="row space-between">
          <h1 className="page-title">Zone dashboard</h1>
          <Link href={`/zones/${zoneId}/data`}>Data & calculations</Link>
        </div>
        {loading && <p className="muted-text">Loading dashboard...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !zone && <p className="muted-text">Zone not found or access denied.</p>}

        {zone && (
          <>
            <form className="stack" onSubmit={onSave}>
              <label className="field">
                <span className="field-label">Zone name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              {zone.zone_type === "admin" ? (
                <AdminAreaMapSelector value={selections} onChange={setSelections} />
              ) : (
                <label className="field">
                  <span className="field-label">Radius meters</span>
                  <input value={radius} onChange={(event) => setRadius(event.target.value)} />
                </label>
              )}
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save zone"}
                </button>
                <Link href="/zones">Back to zones</Link>
              </div>
            </form>

            <article className="card stack">
              <h2 className="section-title">Market view</h2>
              {stats ? (
                <div className="stat-grid">
                  <div className="stat-card">
                    <p className="stat-label">P10</p>
                    <p className="stat-value">{stats.p10_ratio_years ?? "-"}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">P50</p>
                    <p className="stat-value">{stats.p50_ratio_years ?? "-"}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">P90</p>
                    <p className="stat-value">{stats.p90_ratio_years ?? "-"}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Eligible buys</p>
                    <p className="stat-value">{stats.eligible_buy_count}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Eligible rents</p>
                    <p className="stat-value">{stats.eligible_rent_count}</p>
                  </div>
                </div>
              ) : (
                <p className="muted-text">No stats yet. Wait for the daily backend run.</p>
              )}
            </article>

            <article className="card stack">
              <h2 className="section-title">Deals</h2>
              {deals.length === 0 ? (
                <p className="muted-text">No deals yet for this zone.</p>
              ) : (
                deals.map((deal) => (
                  <div key={`${deal.zone_id}-${deal.listing_id}`} className="card stack">
                    <div className="row space-between">
                      <strong>Deal #{deal.rank_in_zone ?? "-"}</strong>
                      <div className="row">
                        <SourceChip source={deal.listing?.source} />
                        <span className="badge">{deal.rent_source}</span>
                      </div>
                    </div>
                    <p className="muted-text">Listing: {deal.listing?.title ?? deal.listing_id}</p>
                    <p>Ratio years: {deal.ratio_years.toFixed(2)}</p>
                    <p>
                      Price: EUR {deal.listing?.price_eur ?? "-"} | Estimated rent: EUR{" "}
                      {deal.estimated_monthly_rent_eur.toFixed(0)} / month
                    </p>
                    <Link href={`/deals/${zoneId}/${deal.listing_id}`}>Open deal detail</Link>
                  </div>
                ))
              )}
            </article>
          </>
        )}
      </section>
    </main>
  );
}
