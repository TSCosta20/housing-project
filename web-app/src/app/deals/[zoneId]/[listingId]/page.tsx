"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import SourceChip from "@/components/SourceChip";
import { getListingById, getZoneDeals } from "@/lib/api";
import { buildSourceSearchUrl, normalizeExternalUrl } from "@/lib/sourceLinks";
import type { ListingNormalized, ListingScoring } from "@/lib/types";

export default function DealDetailPage() {
  const params = useParams<{ zoneId: string; listingId: string }>();
  const zoneId = params.zoneId;
  const listingId = params.listingId;

  const [listing, setListing] = useState<ListingNormalized | null>(null);
  const [deal, setDeal] = useState<ListingScoring | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mailtoHref = useMemo(() => {
    if (!listing?.contact_email) return null;
    const subject = encodeURIComponent("Offer for property");
    const body = encodeURIComponent("Hello, I am interested in this property.");
    return `mailto:${listing.contact_email}?subject=${subject}&body=${body}`;
  }, [listing]);

  const sourceHref = useMemo(() => normalizeExternalUrl(listing?.url), [listing?.url]);
  const sourceSearchHref = useMemo(
    () => buildSourceSearchUrl(listing?.source, listing?.title),
    [listing?.source, listing?.title],
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [listingResult, deals] = await Promise.all([getListingById(listingId), getZoneDeals(zoneId)]);
        setListing(listingResult);
        setDeal(deals.find((item) => item.listing_id === listingId) ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load deal.");
      } finally {
        setLoading(false);
      }
    }

    load().catch(() => undefined);
  }, [zoneId, listingId]);

  return (
    <main className="page-wrap stack">
      <AppNav />
      <section className="card stack">
        <h1 className="page-title">Deal detail</h1>
        {loading && <p className="muted-text">Loading deal...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !listing && <p className="muted-text">Listing not found.</p>}

        {listing && (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <p className="stat-label">Source</p>
                <div className="row">
                  <SourceChip source={listing.source} />
                </div>
              </div>
              <div className="stat-card">
                <p className="stat-label">Price</p>
                <p className="stat-value">EUR {listing.price_eur}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Estimated rent</p>
                <p className="stat-value">{deal?.estimated_monthly_rent_eur ?? "-"}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Ratio years</p>
                <p className="stat-value">{deal?.ratio_years?.toFixed(2) ?? "-"}</p>
              </div>
            </div>
            <p>
              <strong>{listing.title ?? listing.id}</strong>
            </p>
            <div className="row">
              {sourceHref && (
                <a href={sourceHref} target="_blank" rel="noreferrer">
                  Open source website
                </a>
              )}
              {sourceSearchHref && (
                <a href={sourceSearchHref} target="_blank" rel="noreferrer">
                  Search on source
                </a>
              )}
              {listing.contact_phone && <a href={`tel:${listing.contact_phone}`}>Call now</a>}
              {mailtoHref && <a href={mailtoHref}>Send offer email</a>}
              <Link href={`/zones/${zoneId}`}>Back to zone dashboard</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
