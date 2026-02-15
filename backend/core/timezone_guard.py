from __future__ import annotations

import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def should_run_lisbon_time(
    now_utc: datetime | None = None,
    target_hour: int | None = None,
    target_minute: int | None = None,
) -> bool:
    """
    True if current Lisbon time equals target hour/minute.
    """
    resolved_hour = target_hour if target_hour is not None else _env_int("RUN_HOUR_LISBON", default=3)
    resolved_minute = target_minute if target_minute is not None else _env_int("RUN_MINUTE_LISBON", default=0)

    resolved_hour = max(0, min(23, resolved_hour))
    resolved_minute = max(0, min(59, resolved_minute))

    current_utc = now_utc or datetime.now(timezone.utc)
    lisbon = current_utc.astimezone(ZoneInfo("Europe/Lisbon"))
    return lisbon.hour == resolved_hour and lisbon.minute == resolved_minute


def should_run_lisbon_5am(now_utc: datetime | None = None, target_hour: int = 5) -> bool:
    """
    Backward-compatible wrapper kept for older imports.
    """
    return should_run_lisbon_time(now_utc=now_utc, target_hour=target_hour, target_minute=0)


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except (TypeError, ValueError):
        return default
