"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import SourceChip from "@/components/SourceChip";
import {
  getDashboardListingsByRegion,
  getDashboardListingsBySource,
  getDashboardListingsByTypology,
  getImportDashboardMetrics,
  getSession,
} from "@/lib/api";
import { buildSourceSearchUrl, normalizeExternalUrl } from "@/lib/sourceLinks";
import type { DashboardListingRow, ImportDashboardMetrics, SourceImportMetrics } from "@/lib/types";

type RegionLevel = "district" | "municipality" | "parish";

function fmtCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function fmtTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function statusBadge(status: SourceImportMetrics["last_raw_status"]): string {
  if (status === "ok") return "badge";
  if (status === "failed" || status === "blocked") return "badge danger";
  return "badge";
}

function getListingTypology(title: string | null, bedrooms: number | null): string {
  const rawTitle = String(title ?? "");
  const titleMatch = rawTitle.match(/\b[tT]\s*([0-9]{1,2})(?:\s*\+\s*([0-9]{1,2}))?\b/);
  if (titleMatch) {
    const base = titleMatch[1];
    const extra = titleMatch[2];
    return extra ? `T${base}+${extra}` : `T${base}`;
  }
  if (typeof bedrooms === "number" && Number.isFinite(bedrooms) && bedrooms >= 0) {
    return `T${Math.round(bedrooms)}`;
  }
  return "Unknown";
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<ImportDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regionLevel, setRegionLevel] = useState<RegionLevel>("district");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedListings, setExpandedListings] = useState<Record<string, DashboardListingRow[]>>({});
  const [loadingExpanded, setLoadingExpanded] = useState<Record<string, boolean>>({});
  const [expandedError, setExpandedError] = useState<Record<string, string | null>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await getSession();
      if (!session) {
        window.location.href = "/auth";
        return;
      }
      const data = await getImportDashboardMetrics();
      setMetrics(data);
      setExpandedKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const orderedSources = useMemo(() => {
    return [...(metrics?.sources ?? [])].sort((a, b) => b.raw_last_24h - a.raw_last_24h);
  }, [metrics]);
  const regionRows = useMemo(() => metrics?.regions[regionLevel] ?? [], [metrics, regionLevel]);
  const typologyRows = useMemo(() => metrics?.typologies ?? [], [metrics]);

  const loadExpanded = useCallback(
    async (key: string, loader: () => Promise<DashboardListingRow[]>) => {
      if (expandedListings[key]) {
        return;
      }
      setLoadingExpanded((prev) => ({ ...prev, [key]: true }));
      setExpandedError((prev) => ({ ...prev, [key]: null }));
      try {
        const rows = await loader();
        setExpandedListings((prev) => ({ ...prev, [key]: rows }));
      } catch (err) {
        setExpandedError((prev) => ({
          ...prev,
          [key]: err instanceof Error ? err.message : "Failed to load listings.",
        }));
      } finally {
        setLoadingExpanded((prev) => ({ ...prev, [key]: false }));
      }
    },
    [expandedListings],
  );

  const onSourceRowClick = useCallback(
    async (source: string) => {
      const key = `source:${source}`;
      setExpandedKey((prev) => (prev === key ? null : key));
      await loadExpanded(key, () => getDashboardListingsBySource(source));
    },
    [loadExpanded],
  );

  const onRegionRowClick = useCallback(
    async (region: string) => {
      const key = `region:${regionLevel}:${region}`;
      setExpandedKey((prev) => (prev === key ? null : key));
      await loadExpanded(key, () => getDashboardListingsByRegion(regionLevel, region));
    },
    [loadExpanded, regionLevel],
  );

  const onTypologyRowClick = useCallback(
    async (typology: string) => {
      const key = `typology:${typology}`;
      setExpandedKey((prev) => (prev === key ? null : key));
      await loadExpanded(key, () => getDashboardListingsByTypology(typology));
    },
    [loadExpanded],
  );

  function renderExpandedRow(key: string, colSpan: number) {
    if (expandedKey !== key) return null;
    if (loadingExpanded[key]) {
      return (
        <tr>
          <td colSpan={colSpan}>
            <p className="muted-text">Loading listings...</p>
          </td>
        </tr>
      );
    }
    if (expandedError[key]) {
      return (
        <tr>
          <td colSpan={colSpan}>
            <p className="error-text">{expandedError[key]}</p>
          </td>
        </tr>
      );
    }
    const items = expandedListings[key] ?? [];
    return (
      <tr>
        <td colSpan={colSpan}>
          <div className="nested-table-wrap">
            <table className="table nested-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Typology</th>
                  <th>Price</th>
                  <th>Location</th>
                  <th>Last seen</th>
                  <th>Links</th>
                </tr>
              </thead>
              <tbody>
                {items.map((listing) => {
                  const sourceUrl = normalizeExternalUrl(listing.url);
                  const sourceSearch = buildSourceSearchUrl(listing.source, listing.title);
                  return (
                    <tr key={listing.id}>
                      <td>{listing.title ?? listing.id}</td>
                      <td>
                        <SourceChip source={listing.source} />
                      </td>
                      <td>{listing.listing_type ?? "-"}</td>
                      <td>{getListingTypology(listing.title, listing.bedrooms)}</td>
                      <td>EUR {fmtCount(Math.round(listing.price_eur ?? 0))}</td>
                      <td>{listing.location_text ?? "-"}</td>
                      <td>{fmtTime(listing.last_seen_at)}</td>
                      <td>
                        <div className="row">
                          {sourceUrl && (
                            <a href={sourceUrl} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          )}
                          {sourceSearch && (
                            <a href={sourceSearch} target="_blank" rel="noreferrer">
                              Search
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted-text">
                      No listings for this row.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <div className="row space-between">
          <h1 className="page-title">Import dashboard</h1>
          <button className="btn" onClick={() => refresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="stat-grid">
          <article className="stat-card">
            <h3>Total raw rows</h3>
            <strong>{fmtCount(metrics?.total_raw ?? 0)}</strong>
            <p className="muted-text">All-time imports from every source.</p>
          </article>
          <article className="stat-card">
            <h3>Raw rows (24h)</h3>
            <strong>{fmtCount(metrics?.total_raw_last_24h ?? 0)}</strong>
            <p className="muted-text">Rows fetched in the last 24 hours.</p>
          </article>
          <article className="stat-card">
            <h3>Normalized rows</h3>
            <strong>{fmtCount(metrics?.total_normalized ?? 0)}</strong>
            <p className="muted-text">Rows available for app matching/scoring.</p>
          </article>
          <article className="stat-card">
            <h3>Buy listings</h3>
            <strong>{fmtCount(metrics?.total_buy ?? 0)}</strong>
            <p className="muted-text">Total active normalized listings for buy.</p>
          </article>
          <article className="stat-card">
            <h3>Rent listings</h3>
            <strong>{fmtCount(metrics?.total_rent ?? 0)}</strong>
            <p className="muted-text">Total active normalized listings for rent.</p>
          </article>
        </div>

        {loading && <p className="muted-text">Loading latest import metrics...</p>}

        {!loading && orderedSources.length === 0 && (
          <p className="muted-text">No source metrics available yet.</p>
        )}

        {!loading && orderedSources.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Method</th>
                  <th>Enabled</th>
                  <th>Raw total</th>
                  <th>Raw (24h)</th>
                  <th>Normalized total</th>
                  <th>Last raw import</th>
                  <th>Last raw status</th>
                  <th>Last normalized seen</th>
                </tr>
              </thead>
              <tbody>
                {orderedSources.map((item) => {
                  const key = `source:${item.source}`;
                  return (
                    <Fragment key={key}>
                      <tr className="clickable-row" onClick={() => onSourceRowClick(item.source)}>
                        <td>{item.source}</td>
                        <td>{item.method}</td>
                        <td>
                          <span className={`badge ${item.enabled ? "" : "danger"}`}>
                            {item.enabled ? "yes" : "no"}
                          </span>
                        </td>
                        <td>{fmtCount(item.raw_total)}</td>
                        <td>{fmtCount(item.raw_last_24h)}</td>
                        <td>{fmtCount(item.normalized_total)}</td>
                        <td>{fmtTime(item.last_raw_at)}</td>
                        <td>
                          <span className={statusBadge(item.last_raw_status)}>{item.last_raw_status ?? "-"}</span>
                        </td>
                        <td>{fmtTime(item.last_normalized_at)}</td>
                      </tr>
                      {renderExpandedRow(key, 9)}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <>
            <div className="row space-between">
              <h2 className="section-title">Region breakdown</h2>
              <label className="field" style={{ minWidth: 210 }}>
                <span className="field-label">Region level</span>
                <select value={regionLevel} onChange={(event) => setRegionLevel(event.target.value as RegionLevel)}>
                  <option value="district">district</option>
                  <option value="municipality">municipality</option>
                  <option value="parish">parish</option>
                </select>
              </label>
            </div>

            {regionRows.length === 0 ? (
              <p className="muted-text">No region metrics available.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{regionLevel}</th>
                      <th>Buy</th>
                      <th>Rent</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionRows.map((row) => {
                      const key = `region:${regionLevel}:${row.region}`;
                      return (
                        <Fragment key={key}>
                          <tr className="clickable-row" onClick={() => onRegionRowClick(row.region)}>
                            <td>{row.region}</td>
                            <td>{fmtCount(row.buy_count)}</td>
                            <td>{fmtCount(row.rent_count)}</td>
                            <td>{fmtCount(row.total_count)}</td>
                          </tr>
                          {renderExpandedRow(key, 4)}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <h2 className="section-title">Totals by typology</h2>
            {typologyRows.length === 0 ? (
              <p className="muted-text">No typology metrics available.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Typology</th>
                      <th>Buy</th>
                      <th>Rent</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typologyRows.map((row) => {
                      const key = `typology:${row.typology}`;
                      return (
                        <Fragment key={key}>
                          <tr className="clickable-row" onClick={() => onTypologyRowClick(row.typology)}>
                            <td>{row.typology}</td>
                            <td>{fmtCount(row.buy_count)}</td>
                            <td>{fmtCount(row.rent_count)}</td>
                            <td>{fmtCount(row.total_count)}</td>
                          </tr>
                          {renderExpandedRow(key, 4)}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
