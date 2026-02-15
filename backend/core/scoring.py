from __future__ import annotations

import os
import unicodedata
import urllib.parse
import urllib.request
from functools import lru_cache
from dataclasses import dataclass
from datetime import date
import json
from statistics import median
from typing import Any


MIN_SAMPLE = 30
PUBLIC_ADMIN_BASE_URL = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets"
PUBLIC_ADMIN_PAGE_LIMIT = 100


@dataclass(slots=True)
class ZoneStats:
    zone_id: str
    stats_date: date
    eligible_buy_count: int
    eligible_rent_count: int
    p10_ratio_years: float | None
    p50_ratio_years: float | None
    p90_ratio_years: float | None
    median_rent_eur_m2: float | None
    min_sample_used: bool


def point_in_polygon(lat: float, lng: float, polygon_coordinates: list[list[float]]) -> bool:
    # Ray casting with (lng, lat) points in GeoJSON order.
    inside = False
    j = len(polygon_coordinates) - 1
    for i, point in enumerate(polygon_coordinates):
        xi, yi = point[0], point[1]
        xj, yj = polygon_coordinates[j][0], polygon_coordinates[j][1]
        if (yi > lat) != (yj > lat):
            denominator = (yj - yi) or 1e-9
            x_intersect = (xj - xi) * (lat - yi) / denominator + xi
            if lng < x_intersect:
                inside = not inside
        j = i
    return inside


def haversine_distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    r = 6_371_000.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * r * asin(sqrt(a))


def matches_zone(zone: dict[str, Any], listing: dict[str, Any]) -> bool:
    zt = zone.get("zone_type")
    lat = listing.get("lat")
    lng = listing.get("lng")

    if zt in {"radius", "polygon"} and (lat is None or lng is None):
        # Test-only fallback for sources without coordinates.
        if os.environ.get("ALLOW_ZONE_MATCH_WITHOUT_GEO", "").lower() in {"1", "true", "yes"}:
            return True
        return False

    if zt == "radius":
        c_lat = zone.get("center_lat")
        c_lng = zone.get("center_lng")
        radius = zone.get("radius_meters")
        if c_lat is None or c_lng is None or radius is None:
            return False
        return haversine_distance_meters(float(c_lat), float(c_lng), float(lat), float(lng)) <= float(radius)

    if zt == "polygon":
        geo = zone.get("polygon_geojson") or {}
        coords = geo.get("coordinates") or []
        if not coords:
            return False
        ring = coords[0]
        return point_in_polygon(float(lat), float(lng), ring)

    if zt == "admin":
        admin_codes = zone.get("admin_codes") or {}
        if not isinstance(admin_codes, dict):
            return False
        listing_admin = get_location_admin_keys(listing.get("location_text"))
        selections = _extract_zone_admin_selections(admin_codes)
        if not selections:
            return False

        for selected in selections:
            country = _normalize_admin_text(selected.get("country"))
            district = _normalize_admin_text(selected.get("district"))
            municipality = _normalize_admin_text(selected.get("municipality"))
            parish = _normalize_admin_text(selected.get("parish") or selected.get("freguesia"))

            if not any([country, district, municipality, parish]):
                continue
            if country and country != listing_admin.get("country"):
                continue
            if district and district != listing_admin.get("district"):
                continue
            if municipality and municipality != listing_admin.get("municipality"):
                continue
            if parish and parish != listing_admin.get("parish"):
                continue
            return True
        return False

    return False


def estimate_rent(
    buy_listing: dict[str, Any],
    rent_candidates: list[dict[str, Any]],
    parish_bedroom_median_rent_eur_m2: float | None,
) -> tuple[float | None, str | None]:
    bedrooms = buy_listing.get("bedrooms")
    size_m2 = buy_listing.get("size_m2")
    buy_parish_key = get_parish_key(buy_listing.get("location_text"))
    buy_bedrooms = _safe_int(bedrooms)
    if not buy_parish_key or buy_bedrooms is None:
        return None, None

    direct_comps: list[float] = []
    for rent in rent_candidates:
        rent_parish_key = get_parish_key(rent.get("location_text"))
        if rent_parish_key != buy_parish_key:
            continue
        rent_bedrooms = _safe_int(rent.get("bedrooms"))
        if rent_bedrooms is None or rent_bedrooms != buy_bedrooms:
            continue
        rent_price = rent.get("price_eur")
        rent_size = rent.get("size_m2")
        if rent_price is None or rent_size is None or rent_size <= 0:
            continue
        if size_m2 is not None:
            lower = size_m2 * 0.8
            upper = size_m2 * 1.2
            if not (lower <= rent_size <= upper):
                continue
        direct_comps.append(float(rent_price))

    if direct_comps:
        return float(median(direct_comps)), "direct_match"

    if parish_bedroom_median_rent_eur_m2 is not None and size_m2 is not None:
        return float(parish_bedroom_median_rent_eur_m2 * size_m2), "zone_model"

    return None, None


def ratio_years(price_eur: float, monthly_rent_eur: float) -> float:
    return price_eur / (monthly_rent_eur * 12)


def percentile(sorted_values: list[float], p: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * p
    floor_k = int(k)
    ceil_k = min(floor_k + 1, len(sorted_values) - 1)
    if floor_k == ceil_k:
        return sorted_values[floor_k]
    fraction = k - floor_k
    return sorted_values[floor_k] + (sorted_values[ceil_k] - sorted_values[floor_k]) * fraction


def build_zone_stats(
    zone_id: str,
    stats_date: date,
    ratios: list[float],
    eligible_rent_count: int,
    median_rent_eur_m2: float | None,
) -> ZoneStats:
    sorted_ratios = sorted(ratios)
    enough_sample = len(sorted_ratios) >= MIN_SAMPLE

    if enough_sample:
        p10 = percentile(sorted_ratios, 0.10)
    else:
        # Fallback from docs: P20 or lowest N; we use P20 for threshold.
        p10 = percentile(sorted_ratios, 0.20)

    return ZoneStats(
        zone_id=zone_id,
        stats_date=stats_date,
        eligible_buy_count=len(sorted_ratios),
        eligible_rent_count=eligible_rent_count,
        p10_ratio_years=p10,
        p50_ratio_years=percentile(sorted_ratios, 0.50),
        p90_ratio_years=percentile(sorted_ratios, 0.90),
        median_rent_eur_m2=median_rent_eur_m2,
        min_sample_used=not enough_sample,
    )


def get_parish_key(location_text: Any) -> str | None:
    if not isinstance(location_text, str):
        return None
    value = location_text.strip()
    if not value:
        return None
    # Keep only parish-like first segment and normalize for stable comparisons.
    first = value.split(",")[0].strip().lower()
    normalized = unicodedata.normalize("NFKD", first)
    ascii_text = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    compact = " ".join(ascii_text.split())
    return compact or None


def get_location_admin_keys(location_text: Any) -> dict[str, str | None]:
    base = {"country": "pt", "district": None, "municipality": None, "parish": None}
    if not isinstance(location_text, str):
        return base

    parts = [part.strip() for part in location_text.split(",") if part.strip()]
    raw_parish = parts[0] if len(parts) >= 1 else None
    raw_municipality = parts[1] if len(parts) >= 2 else None
    raw_district = parts[2] if len(parts) >= 3 else None

    parish = _normalize_admin_text(raw_parish)
    municipality = _normalize_admin_text(raw_municipality)
    district = _normalize_admin_text(raw_district)

    index = _load_public_admin_index()
    if district and municipality and (district, municipality) not in index["municipality_keys"]:
        if municipality in index["municipality_unique"]:
            district = index["municipality_unique"][municipality][0]
        else:
            municipality = None
            district = None

    if parish:
        if district and municipality and (district, municipality, parish) in index["parish_keys"]:
            return {"country": "pt", "district": district, "municipality": municipality, "parish": parish}
        if municipality and parish:
            key = (municipality, parish)
            candidate = index["parish_by_municipality_unique"].get(key)
            if candidate:
                return {"country": "pt", "district": candidate[0], "municipality": candidate[1], "parish": candidate[2]}
        candidate = index["parish_unique"].get(parish)
        if candidate:
            return {"country": "pt", "district": candidate[0], "municipality": candidate[1], "parish": candidate[2]}

    return {"country": "pt", "district": district, "municipality": municipality, "parish": parish}


def _extract_zone_admin_selections(admin_codes: dict[str, Any]) -> list[dict[str, Any]]:
    raw = admin_codes.get("selections")
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]

    # Backward compatibility for legacy single-parish zones.
    legacy_parish = admin_codes.get("parish") or admin_codes.get("freguesia") or admin_codes.get("name")
    if legacy_parish:
        return [
            {
                "country": admin_codes.get("country") or "PT",
                "parish": legacy_parish,
            }
        ]
    return []


def _normalize_admin_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip().lower()
    if not stripped:
        return None
    normalized = unicodedata.normalize("NFKD", stripped)
    ascii_text = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    compact = " ".join(ascii_text.split())
    return compact or None


@lru_cache(maxsize=1)
def _load_public_admin_index() -> dict[str, Any]:
    empty = {
        "municipality_keys": set(),
        "parish_keys": set(),
        "municipality_unique": {},
        "parish_unique": {},
        "parish_by_municipality_unique": {},
    }
    try:
        municipalities = _fetch_public_records("georef-portugal-concelho", "con_name,dis_name")
        parishes = _fetch_public_records("georef-portugal-freguesia", "fre_name,con_name,dis_name")
    except Exception:
        return empty

    municipality_keys: set[tuple[str, str]] = set()
    parish_keys: set[tuple[str, str, str]] = set()
    municipality_name_to_candidates: dict[str, set[tuple[str, str]]] = {}
    parish_name_to_candidates: dict[str, set[tuple[str, str, str]]] = {}
    parish_municipality_to_candidates: dict[tuple[str, str], set[tuple[str, str, str]]] = {}

    for row in municipalities:
        district = _normalize_admin_text(row.get("dis_name"))
        municipality = _normalize_admin_text(row.get("con_name"))
        if not district or not municipality:
            continue
        key = (district, municipality)
        municipality_keys.add(key)
        municipality_name_to_candidates.setdefault(municipality, set()).add(key)

    for row in parishes:
        district = _normalize_admin_text(row.get("dis_name"))
        municipality = _normalize_admin_text(row.get("con_name"))
        parish = _normalize_admin_text(row.get("fre_name"))
        if not district or not municipality or not parish:
            continue
        key = (district, municipality, parish)
        parish_keys.add(key)
        parish_name_to_candidates.setdefault(parish, set()).add(key)
        parish_municipality_to_candidates.setdefault((municipality, parish), set()).add(key)

    municipality_unique = {
        name: next(iter(candidates))
        for name, candidates in municipality_name_to_candidates.items()
        if len(candidates) == 1
    }
    parish_unique = {
        name: next(iter(candidates))
        for name, candidates in parish_name_to_candidates.items()
        if len(candidates) == 1
    }
    parish_by_municipality_unique = {
        name: next(iter(candidates))
        for name, candidates in parish_municipality_to_candidates.items()
        if len(candidates) == 1
    }

    return {
        "municipality_keys": municipality_keys,
        "parish_keys": parish_keys,
        "municipality_unique": municipality_unique,
        "parish_unique": parish_unique,
        "parish_by_municipality_unique": parish_by_municipality_unique,
    }


def _fetch_public_records(dataset: str, select_fields: str) -> list[dict[str, Any]]:
    offset = 0
    out: list[dict[str, Any]] = []
    while True:
        params = urllib.parse.urlencode(
            {
                "select": select_fields,
                "limit": PUBLIC_ADMIN_PAGE_LIMIT,
                "offset": offset,
            }
        )
        url = f"{PUBLIC_ADMIN_BASE_URL}/{dataset}/records?{params}"
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        rows = payload.get("results") or []
        out.extend(rows)
        offset += len(rows)
        total_count = payload.get("total_count")
        if len(rows) < PUBLIC_ADMIN_PAGE_LIMIT:
            break
        if isinstance(total_count, int) and offset >= total_count:
            break
    return out


def _safe_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
