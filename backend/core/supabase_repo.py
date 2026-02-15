from __future__ import annotations

import os
from typing import Any

from supabase import Client, create_client


class SupabaseRepo:
    def __init__(self, url: str | None = None, service_role_key: str | None = None) -> None:
        supabase_url = url or os.environ.get("SUPABASE_URL")
        supabase_key = service_role_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        self.client: Client = create_client(supabase_url, supabase_key)
        self._raw_on_conflict_supported: bool | None = None

    def get_enabled_sources(self) -> list[dict[str, Any]]:
        return self.client.table("sources").select("name, method, enabled").eq("enabled", True).execute().data or []

    def get_active_zones(self) -> list[dict[str, Any]]:
        return self.client.table("zones").select("*").eq("is_active", True).execute().data or []

    def insert_raw_listing(self, row: dict[str, Any]) -> None:
        self.client.table("listings_raw").insert(row).execute()

    def insert_raw_listing_if_new(self, row: dict[str, Any]) -> None:
        """
        Prefer DB-level dedupe on (source, hash) when unique index exists.
        Fallback to read-before-write when migration is not yet applied.
        """
        if self._raw_on_conflict_supported is not False:
            try:
                self.client.table("listings_raw").upsert(row, on_conflict="source,hash").execute()
                self._raw_on_conflict_supported = True
                return
            except Exception as exc:
                # Postgres 42P10: on_conflict columns do not match a unique/exclusion constraint.
                if "42P10" not in str(exc):
                    raise exc
                self._raw_on_conflict_supported = False

        source = str(row.get("source") or "")
        raw_hash = str(row.get("hash") or "")
        if source and raw_hash and not self.raw_listing_hash_exists(source, raw_hash):
            self.insert_raw_listing(row)

    def raw_listing_hash_exists(self, source: str, raw_hash: str) -> bool:
        rows = (
            self.client.table("listings_raw")
            .select("id")
            .eq("source", source)
            .eq("hash", raw_hash)
            .limit(1)
            .execute()
            .data
            or []
        )
        return bool(rows)

    def upsert_normalized_listing(self, row: dict[str, Any]) -> dict[str, Any]:
        row_id = row.get("id")
        if row_id:
            update_row = dict(row)
            # Preserve first_seen_at for existing listings.
            update_row.pop("first_seen_at", None)
            response = (
                self.client.table("listings_normalized")
                .update(update_row)
                .eq("id", row_id)
                .execute()
            )
            return (response.data or [{}])[0]

        try:
            response = self.client.table("listings_normalized").insert(row).execute()
            return (response.data or [{}])[0]
        except Exception as exc:
            # Fallback to fetch existing row for known dedupe keys.
            candidates = self.find_normalized_candidates(
                source=row.get("source", ""),
                external_id=row.get("external_id"),
                url=row.get("url"),
            )
            if candidates:
                return candidates[0]
            raise exc

    def find_normalized_candidates(self, source: str, external_id: str | None, url: str | None) -> list[dict[str, Any]]:
        query = self.client.table("listings_normalized").select("id, source, external_id, url, last_price_eur")
        if external_id:
            return query.eq("source", source).eq("external_id", external_id).execute().data or []
        if url:
            # URL uniqueness is enforced case-insensitively in DB (lower(url)).
            # Use ilike to recover rows when incoming URL casing differs.
            return query.ilike("url", url).execute().data or []
        return []

    def upsert_zone_membership(self, row: dict[str, Any]) -> None:
        self.client.table("listing_zone_membership").upsert(row, on_conflict="zone_id,listing_id").execute()

    def upsert_zone_daily_stats(self, row: dict[str, Any]) -> None:
        self.client.table("zone_daily_stats").upsert(row, on_conflict="zone_id,stats_date").execute()

    def upsert_listing_scoring_daily(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            self.client.table("listing_scoring_daily").upsert(
                rows, on_conflict="zone_id,listing_id,stats_date"
            ).execute()

    def get_deal_events_for_listing_zone(self, zone_id: str, listing_id: str) -> list[dict[str, Any]]:
        return (
            self.client.table("deal_events")
            .select("id, triggered_at, price_eur, trigger_type")
            .eq("zone_id", zone_id)
            .eq("listing_id", listing_id)
            .order("triggered_at", desc=True)
            .execute()
            .data
            or []
        )

    def insert_deal_event(self, row: dict[str, Any]) -> None:
        self.client.table("deal_events").insert(row).execute()

    def get_unnotified_push_events(self) -> list[dict[str, Any]]:
        return (
            self.client.table("deal_events")
            .select("id, zone_id, listing_id, trigger_type, ratio_years, price_eur")
            .eq("was_notified_push", False)
            .execute()
            .data
            or []
        )

    def get_zone_owner_user_id(self, zone_id: str) -> str | None:
        rows = self.client.table("zones").select("user_id").eq("id", zone_id).limit(1).execute().data or []
        return rows[0]["user_id"] if rows else None

    def get_device_tokens(self, user_id: str) -> list[str]:
        rows = (
            self.client.table("device_tokens")
            .select("device_token")
            .eq("user_id", user_id)
            .execute()
            .data
            or []
        )
        return [row["device_token"] for row in rows if row.get("device_token")]

    def mark_deal_event_push_notified(self, event_id: str) -> None:
        self.client.table("deal_events").update({"was_notified_push": True}).eq("id", event_id).execute()
