from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from backend.core.models import NormalizedListing


def build_listing_hash(source: str, external_id: str | None, url: str | None, payload: dict[str, Any]) -> str:
    stable = {
        "source": source,
        "external_id": external_id,
        "url": (url or "").strip().lower(),
        "payload": payload,
    }
    serialized = json.dumps(stable, sort_keys=True, ensure_ascii=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def listing_to_record(listing: NormalizedListing) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    size_m2 = listing.size_m2 if listing.size_m2 is not None and float(listing.size_m2) > 0 else None
    lat = listing.lat if listing.lat is not None and -90 <= float(listing.lat) <= 90 else None
    lng = listing.lng if listing.lng is not None and -180 <= float(listing.lng) <= 180 else None
    return {
        "source": listing.source,
        "external_id": listing.external_id,
        "url": listing.url,
        "listing_type": listing.listing_type,
        "title": listing.title,
        "price_eur": listing.price_eur,
        "size_m2": size_m2,
        "bedrooms": listing.bedrooms,
        "bathrooms": listing.bathrooms,
        "lat": lat,
        "lng": lng,
        "location_text": listing.location_text,
        "contact_phone": listing.contact_phone,
        "contact_email": listing.contact_email,
        "first_seen_at": now,
        "last_seen_at": now,
        "last_price_eur": listing.price_eur,
        "is_active": True,
        "quality_flags": listing.quality_flags,
    }
