"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import SourceChip from "@/components/SourceChip";
import { getSession, listListings } from "@/lib/api";
import { buildSourceSearchUrl, normalizeExternalUrl } from "@/lib/sourceLinks";
import type { ListingNormalized } from "@/lib/types";

type ListingFilter = "all" | "buy" | "rent";

export default function ListingsPage() {
  const [items, setItems] = useState<ListingNormalized[]>([]);
  const [filter, setFilter] = useState<ListingFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (nextFilter: ListingFilter = filter) => {
    setLoading(true);
    setError(null);
    try {
      const session = await getSession();
      if (!session) {
        window.location.href = "/auth";
        return;
      }
      const listingType = nextFilter === "all" ? undefined : nextFilter;
      const result = await listListings(listingType);
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load listings.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const titleText = useMemo(() => {
    if (filter === "buy") return "Buy listings";
    if (filter === "rent") return "Rent listings";
    return "All listings";
  }, [filter]);

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <div className="row space-between">
          <h1 className="page-title">{titleText}</h1>
          <div className="row">
            <label className="field" style={{ minWidth: 180 }}>
              <span className="field-label">Filter type</span>
              <select
                value={filter}
                onChange={(event) => {
                  const value = event.target.value as ListingFilter;
                  setFilter(value);
                  refresh(value).catch(() => undefined);
                }}
              >
                <option value="all">all</option>
                <option value="buy">buy</option>
                <option value="rent">rent</option>
              </select>
            </label>
            <button className="btn" onClick={() => refresh()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
        {loading && <p className="muted-text">Loading listings...</p>}
        {!loading && items.length === 0 && <p className="muted-text">No listings found for this filter.</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="list-grid">
          {items.map((item) => {
            const sourceUrl = normalizeExternalUrl(item.url);
            const sourceSearch = buildSourceSearchUrl(item.source, item.title);
            return (
              <article key={item.id} className="card stack">
                <div className="row space-between">
                  <strong>{item.title ?? item.id}</strong>
                  <div className="row">
                    <SourceChip source={item.source} />
                    <span className="badge">{item.listing_type ?? "-"}</span>
                  </div>
                </div>
                <p className="muted-text">
                  Price: EUR {item.price_eur} | Last seen:{" "}
                  {item.last_seen_at ? new Date(item.last_seen_at).toLocaleString() : "-"}
                </p>
                <div className="row">
                  {sourceUrl && (
                    <a href={sourceUrl} target="_blank" rel="noreferrer">
                      Open source website
                    </a>
                  )}
                  {sourceSearch && (
                    <a href={sourceSearch} target="_blank" rel="noreferrer">
                      Search on source
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
