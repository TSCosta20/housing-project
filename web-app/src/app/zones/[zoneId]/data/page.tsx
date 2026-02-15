"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import SourceChip from "@/components/SourceChip";
import {
  getLatestZoneStats,
  getRawListingsForSources,
  getZone,
  getZoneMembershipRows,
  getZoneScoringRows,
} from "@/lib/api";
import type { RawListingRow, Zone, ZoneDailyStats, ZoneMembershipRow, ListingScoring } from "@/lib/types";

function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

function toCalcText(row: ListingScoring): string {
  const price = row.listing?.price_eur;
  const rent = row.estimated_monthly_rent_eur;
  if (!price || !rent) return "ratio = price / (estimated_rent * 12)";
  const denominator = rent * 12;
  return `ratio = ${price.toFixed(0)} / (${rent.toFixed(0)} * 12) = ${(price / denominator).toFixed(3)} years`;
}

function payloadPreview(payload: Record<string, unknown>): string {
  const serialized = JSON.stringify(payload, null, 2) ?? "{}";
  if (serialized.length > 1400) return `${serialized.slice(0, 1400)}\n...`;
  return serialized;
}

export default function ZoneDataPage() {
  const params = useParams<{ zoneId: string }>();
  const zoneId = params.zoneId;

  const [zone, setZone] = useState<Zone | null>(null);
  const [stats, setStats] = useState<ZoneDailyStats | null>(null);
  const [scoringRows, setScoringRows] = useState<ListingScoring[]>([]);
  const [membershipRows, setMembershipRows] = useState<ZoneMembershipRow[]>([]);
  const [rawRows, setRawRows] = useState<RawListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [zoneResult, statsResult, scoringResult, membershipResult] = await Promise.all([
        getZone(zoneId),
        getLatestZoneStats(zoneId),
        getZoneScoringRows(zoneId),
        getZoneMembershipRows(zoneId),
      ]);
      setZone(zoneResult);
      setStats(statsResult);
      setScoringRows(scoringResult);
      setMembershipRows(membershipResult);

      const sources = Array.from(
        new Set(
          [
            ...scoringResult.map((row) => row.listing?.source),
            ...membershipResult.map((row) => row.listing?.source),
          ].filter((value): value is string => Boolean(value)),
        ),
      );
      const rawResult = await getRawListingsForSources(sources, 60);
      setRawRows(rawResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load raw data page.");
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const dealsCount = useMemo(() => scoringRows.filter((row) => row.is_deal_p10).length, [scoringRows]);

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <div className="row space-between">
          <h1 className="page-title">Data & calculations</h1>
          <div className="row">
            <button className="btn" onClick={() => load()} disabled={loading}>
              Refresh
            </button>
            <Link href={`/zones/${zoneId}`}>Back to dashboard</Link>
          </div>
        </div>
        <p className="muted-text">
          Transparent view of raw records, zone matches, and how ratios/deals are calculated.
        </p>
        {zone && (
          <p className="muted-text">
            Zone: <strong>{zone.name}</strong> ({zone.zone_type})
          </p>
        )}
        {loading && <p className="muted-text">Loading data...</p>}
        {error && <p className="error-text">{error}</p>}
      </section>

      {!loading && !error && (
        <>
          <section className="card stack">
            <h2 className="section-title">How deal score is calculated</h2>
            <div className="stat-grid">
              <div className="stat-card">
                <p className="stat-label">Eligible buys</p>
                <p className="stat-value">{stats?.eligible_buy_count ?? 0}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Eligible rents</p>
                <p className="stat-value">{stats?.eligible_rent_count ?? 0}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">P10 threshold</p>
                <p className="stat-value">{fmtNumber(stats?.p10_ratio_years, 3)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Scored listings</p>
                <p className="stat-value">{scoringRows.length}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Deals (is_deal_p10)</p>
                <p className="stat-value">{dealsCount}</p>
              </div>
            </div>
            <p className="muted-text">
              Formula: <code>ratio_years = price_eur / (estimated_monthly_rent_eur * 12)</code>
            </p>
            <p className="muted-text">
              Deal rule: listing is a deal when <code>ratio_years &lt;= p10_ratio_years</code>.
            </p>
          </section>

          <section className="card stack">
            <h2 className="section-title">Scoring rows (latest)</h2>
            {scoringRows.length === 0 ? (
              <p className="muted-text">No scoring rows yet.</p>
            ) : (
              <div className="list-grid">
                {scoringRows.map((row) => (
                  <article key={`${row.zone_id}-${row.listing_id}-${row.stats_date}`} className="card stack">
                    <div className="row space-between">
                      <strong>{row.listing?.title ?? row.listing_id}</strong>
                      <div className="row">
                        <SourceChip source={row.listing?.source} />
                        <span className="badge">{row.rent_source}</span>
                      </div>
                    </div>
                    <p className="muted-text">{toCalcText(row)}</p>
                    <p>
                      Price: EUR {fmtNumber(row.listing?.price_eur, 0)} | Estimated rent: EUR{" "}
                      {fmtNumber(row.estimated_monthly_rent_eur, 0)} / month | Ratio:{" "}
                      {fmtNumber(row.ratio_years, 3)} | Deal: {row.is_deal_p10 ? "Yes" : "No"}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="card stack">
            <h2 className="section-title">Zone membership rows</h2>
            {membershipRows.length === 0 ? (
              <p className="muted-text">No listing-zone matches yet.</p>
            ) : (
              <div className="list-grid">
                {membershipRows.slice(0, 30).map((row) => (
                  <article key={`${row.listing_id}-${row.matched_at}`} className="card stack">
                    <div className="row space-between">
                      <strong>{row.listing?.title ?? row.listing_id}</strong>
                      <SourceChip source={row.listing?.source} />
                    </div>
                    <p className="muted-text">
                      matched_at: {new Date(row.matched_at).toLocaleString()} | listing_type:{" "}
                      {row.listing?.listing_type ?? "-"} | last_seen_at:{" "}
                      {row.listing?.last_seen_at ? new Date(row.listing.last_seen_at).toLocaleString() : "-"}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="card stack">
            <h2 className="section-title">Raw source data sample</h2>
            {rawRows.length === 0 ? (
              <p className="muted-text">No raw rows available.</p>
            ) : (
              <div className="list-grid">
                {rawRows.slice(0, 20).map((row) => (
                  <article key={row.id} className="card stack">
                    <div className="row space-between">
                      <div className="row">
                        <SourceChip source={row.source} />
                        <span className="badge">{row.status}</span>
                      </div>
                      <span className="muted-text">{new Date(row.fetched_at).toLocaleString()}</span>
                    </div>
                    <p className="muted-text">
                      external_id: {row.external_id ?? "-"} | hash: {row.hash.slice(0, 16)}...
                    </p>
                    {row.url && (
                      <a href={row.url} target="_blank" rel="noreferrer">
                        Raw URL
                      </a>
                    )}
                    <details>
                      <summary>raw_payload preview</summary>
                      <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{payloadPreview(row.raw_payload)}</pre>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
