from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any


@dataclass(slots=True)
class NormalizedListing:
    source: str
    listing_type: str  # buy | rent
    external_id: str | None
    url: str | None
    title: str | None
    price_eur: float
    size_m2: float | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    lat: float | None = None
    lng: float | None = None
    location_text: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    quality_flags: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Zone:
    id: str
    user_id: str
    name: str
    zone_type: str
    center_lat: float | None
    center_lng: float | None
    radius_meters: int | None
    admin_codes: dict[str, Any] | None
    polygon_geojson: dict[str, Any] | None
    filters: dict[str, Any]
    is_active: bool


@dataclass(slots=True)
class ListingScore:
    zone_id: str
    listing_id: str
    stats_date: date
    estimated_monthly_rent_eur: float
    rent_source: str  # direct_match | zone_model
    ratio_years: float
    is_deal_p10: bool
    rank_in_zone: int | None
    created_at: datetime
