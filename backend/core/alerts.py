from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


def should_trigger_p10_alert(
    is_deal_p10: bool,
    previous_events: list[dict[str, Any]],
    cooldown_days: int = 30,
) -> bool:
    if not is_deal_p10:
        return False
    if not previous_events:
        return True
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=cooldown_days)
    return all(_parse_dt(event.get("triggered_at")) < cutoff for event in previous_events)


def should_trigger_price_drop(previous_price: float, current_price: float, threshold_pct: float = 5.0) -> bool:
    if previous_price <= 0:
        return False
    drop_pct = ((previous_price - current_price) / previous_price) * 100.0
    return drop_pct >= threshold_pct


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    return datetime(1970, 1, 1, tzinfo=timezone.utc)
