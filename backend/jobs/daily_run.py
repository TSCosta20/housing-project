from __future__ import annotations

import argparse
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from statistics import median
from typing import Any

from backend.collectors.casasapo.collector import CasaSapoCollector
from backend.collectors.idealista.collector import IdealistaCollector
from backend.collectors.imovirtual.collector import ImovirtualCollector
from backend.collectors.olx.collector import OlxCollector
from backend.core.alerts import should_trigger_p10_alert, should_trigger_price_drop
from backend.core.dedupe import choose_existing_listing
from backend.core.normalize import build_listing_hash, listing_to_record
from backend.core.push import send_pending_push_notifications
from backend.core.scoring import build_zone_stats, estimate_rent, get_parish_key, matches_zone, ratio_years
from backend.core.supabase_repo import SupabaseRepo
from backend.core.timezone_guard import should_run_lisbon_time


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger(__name__)


def _collectors_by_name() -> dict[str, Any]:
    return {
        "olx": OlxCollector(),
        "casasapo": CasaSapoCollector(),
        "idealista": IdealistaCollector(),
        "imovirtual": ImovirtualCollector(),
    }


def run_daily(force_run: bool = False) -> None:
    force_run = force_run or os.environ.get("FORCE_RUN", "").lower() in {"1", "true", "yes"}
    run_hour = _env_int("RUN_HOUR_LISBON", 3)
    run_minute = _env_int("RUN_MINUTE_LISBON", 0)
    if not force_run and not should_run_lisbon_time(target_hour=run_hour, target_minute=run_minute):
        LOGGER.info("Timezone guard skipped run (not %02d:%02d Europe/Lisbon).", run_hour, run_minute)
        return
    if force_run:
        LOGGER.info("FORCE_RUN enabled: bypassing timezone guard.")

    repo = SupabaseRepo()
    sources = repo.get_enabled_sources()
    zones = repo.get_active_zones()
    collectors = _collectors_by_name()

    normalized_rows: list[dict[str, Any]] = []
    membership_rows: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    stats_date = now.date().isoformat()

    for source in sources:
        source_name = source["name"]
        collector = collectors.get(source_name)
        if not collector:
            LOGGER.warning("No collector implementation for source=%s", source_name)
            continue

        try:
            raw_items = _fetch_with_retry(collector.fetch, source_name=source_name)
        except Exception as exc:  # noqa: BLE001
            LOGGER.exception("Collector fetch failed for %s: %s", source_name, exc)
            continue

        normalized_for_source = 0
        for item in raw_items:
            raw_hash = build_listing_hash(source_name, str(item.get("id")), item.get("url"), item)
            repo.insert_raw_listing_if_new(
                {
                    "source": source_name,
                    "fetched_at": now.isoformat(),
                    "external_id": str(item.get("id")) if item.get("id") is not None else None,
                    "url": item.get("url"),
                    "raw_payload": item,
                    "hash": raw_hash,
                    "status": "ok",
                }
            )
            normalized = collector.normalize(item)
            if normalized is None:
                continue

            record = listing_to_record(normalized)
            candidates = repo.find_normalized_candidates(normalized.source, normalized.external_id, normalized.url)
            existing = choose_existing_listing(candidates, normalized.source, normalized.external_id, normalized.url)
            if existing:
                record["id"] = existing["id"]
            row = repo.upsert_normalized_listing(record)
            normalized_rows.append(row)
            normalized_for_source += 1
        LOGGER.info(
            "Source=%s fetched=%s normalized=%s",
            source_name,
            len(raw_items),
            normalized_for_source,
        )

    # Source feeds can contain repeated offers in a single run.
    # Keep one row per listing id to avoid duplicate downstream scoring keys.
    normalized_by_id: dict[str, dict[str, Any]] = {}
    for row in normalized_rows:
        listing_id = row.get("id")
        if listing_id:
            normalized_by_id[str(listing_id)] = row
    normalized_rows = list(normalized_by_id.values())

    listings_by_zone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for listing in normalized_rows:
        for zone in zones:
            if matches_zone(zone, listing):
                listings_by_zone[zone["id"]].append(listing)
                membership_rows.append(
                    {
                        "zone_id": zone["id"],
                        "listing_id": listing["id"],
                        "matched_at": now.isoformat(),
                        "match_confidence": 1.0,
                    }
                )

    for member_row in membership_rows:
        repo.upsert_zone_membership(member_row)

    for zone in zones:
        zone_id = zone["id"]
        zone_listings = listings_by_zone.get(zone_id, [])
        buys = [x for x in zone_listings if x.get("listing_type") == "buy"]
        rents = [x for x in zone_listings if x.get("listing_type") == "rent"]

        rent_values_per_m2 = [
            (r["price_eur"] / r["size_m2"])
            for r in rents
            if r.get("price_eur") is not None and r.get("size_m2") not in (None, 0)
        ]
        median_rent_eur_m2 = float(median(rent_values_per_m2)) if rent_values_per_m2 else None
        parish_bedroom_rent_values_per_m2: dict[tuple[str, int], list[float]] = defaultdict(list)
        for rent in rents:
            parish_key = get_parish_key(rent.get("location_text"))
            bedrooms = rent.get("bedrooms")
            try:
                bedroom_key = int(bedrooms) if bedrooms is not None else None
            except (TypeError, ValueError):
                bedroom_key = None
            if not parish_key or bedroom_key is None:
                continue
            rent_price = rent.get("price_eur")
            rent_size = rent.get("size_m2")
            if rent_price is None or rent_size in (None, 0):
                continue
            parish_bedroom_rent_values_per_m2[(parish_key, bedroom_key)].append(
                float(rent_price) / float(rent_size)
            )

        parish_bedroom_median_map = {
            key: float(median(values)) for key, values in parish_bedroom_rent_values_per_m2.items() if values
        }

        ratios: list[float] = []
        scored_rows: list[dict[str, Any]] = []
        for buy in buys:
            parish_key = get_parish_key(buy.get("location_text"))
            bedrooms = buy.get("bedrooms")
            try:
                bedroom_key = int(bedrooms) if bedrooms is not None else None
            except (TypeError, ValueError):
                bedroom_key = None
            parish_bedroom_median = (
                parish_bedroom_median_map.get((parish_key, bedroom_key))
                if parish_key and bedroom_key is not None
                else None
            )
            estimated_rent, rent_source = estimate_rent(buy, rents, parish_bedroom_median)
            if not estimated_rent or not rent_source:
                continue
            ratio = ratio_years(float(buy["price_eur"]), float(estimated_rent))
            ratios.append(ratio)
            scored_rows.append(
                {
                    "zone_id": zone_id,
                    "listing_id": buy["id"],
                    "stats_date": stats_date,
                    "estimated_monthly_rent_eur": round(float(estimated_rent), 2),
                    "rent_source": rent_source,
                    "ratio_years": round(ratio, 4),
                    "is_deal_p10": False,  # set after threshold calc
                    "rank_in_zone": None,
                    "created_at": now.isoformat(),
                }
            )

        stats = build_zone_stats(
            zone_id=zone_id,
            stats_date=now.date(),
            ratios=ratios,
            eligible_rent_count=len(rents),
            median_rent_eur_m2=median_rent_eur_m2,
        )
        repo.upsert_zone_daily_stats(
            {
                "zone_id": zone_id,
                "stats_date": stats_date,
                "eligible_buy_count": stats.eligible_buy_count,
                "eligible_rent_count": stats.eligible_rent_count,
                "p10_ratio_years": stats.p10_ratio_years,
                "p50_ratio_years": stats.p50_ratio_years,
                "p90_ratio_years": stats.p90_ratio_years,
                "median_rent_eur_m2": stats.median_rent_eur_m2,
                "min_sample_used": stats.min_sample_used,
                "computed_at": now.isoformat(),
            }
        )

        threshold = stats.p10_ratio_years
        if threshold is not None:
            scored_rows.sort(key=lambda row: row["ratio_years"])
            for idx, row in enumerate(scored_rows, start=1):
                row["rank_in_zone"] = idx
                row["is_deal_p10"] = row["ratio_years"] <= threshold

                previous_events = repo.get_deal_events_for_listing_zone(row["zone_id"], row["listing_id"])
                if should_trigger_p10_alert(row["is_deal_p10"], previous_events):
                    repo.insert_deal_event(
                        {
                            "zone_id": row["zone_id"],
                            "listing_id": row["listing_id"],
                            "trigger_type": "p10_deal",
                            "ratio_years": row["ratio_years"],
                            "price_eur": _lookup_listing_price(zone_listings, row["listing_id"]),
                            "was_notified_push": False,
                            "was_notified_email": False,
                        }
                    )
                elif previous_events:
                    previous_price = float(previous_events[0].get("price_eur") or 0)
                    current_price = float(_lookup_listing_price(zone_listings, row["listing_id"]) or 0)
                    if should_trigger_price_drop(previous_price=previous_price, current_price=current_price):
                        repo.insert_deal_event(
                            {
                                "zone_id": row["zone_id"],
                                "listing_id": row["listing_id"],
                                "trigger_type": "price_drop",
                                "ratio_years": row["ratio_years"],
                                "price_eur": current_price,
                                "was_notified_push": False,
                                "was_notified_email": False,
                            }
                        )

        repo.upsert_listing_scoring_daily(scored_rows)

    push_count = send_pending_push_notifications(repo)
    LOGGER.info("Daily run completed. push_notifications_sent=%s", push_count)


def _lookup_listing_price(zone_listings: list[dict[str, Any]], listing_id: str) -> float | None:
    for listing in zone_listings:
        if listing.get("id") == listing_id:
            value = listing.get("price_eur")
            return float(value) if value is not None else None
    return None


def _fetch_with_retry(fetch_func: Any, source_name: str, max_attempts: int = 3) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            result = fetch_func()
            return result if isinstance(result, list) else []
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= max_attempts:
                break
            wait_seconds = attempt * 2
            LOGGER.warning(
                "Collector retry source=%s attempt=%s/%s wait=%ss error=%s",
                source_name,
                attempt,
                max_attempts,
                wait_seconds,
                exc,
            )
            time.sleep(wait_seconds)
    if last_error:
        raise last_error
    return []


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except (TypeError, ValueError):
        return default


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run daily ingestion/scoring pipeline.")
    parser.add_argument("--force", action="store_true", help="Bypass configured Lisbon timezone guard.")
    args = parser.parse_args()
    run_daily(force_run=args.force)
