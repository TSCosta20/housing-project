from __future__ import annotations

from typing import Any


def choose_existing_listing(
    candidates: list[dict[str, Any]],
    source: str,
    external_id: str | None,
    url: str | None,
) -> dict[str, Any] | None:
    """
    Primary dedupe key: (source, external_id), fallback: url.
    """
    if external_id:
        for row in candidates:
            if row.get("source") == source and row.get("external_id") == external_id:
                return row
    if url:
        needle = url.strip().lower()
        for row in candidates:
            row_url = (row.get("url") or "").strip().lower()
            if row_url and row_url == needle:
                return row
    return None
