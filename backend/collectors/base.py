from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from backend.core.models import NormalizedListing


class Collector(ABC):
    source_name: str

    @abstractmethod
    def fetch(self) -> list[dict[str, Any]]:
        """Fetch raw items from source."""

    @abstractmethod
    def normalize(self, raw_item: dict[str, Any]) -> NormalizedListing | None:
        """Normalize source item into canonical listing."""

    def fetch_timestamp(self) -> datetime:
        return datetime.now(timezone.utc)
