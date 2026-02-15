from __future__ import annotations

import html
import json
import os
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from typing import Any

import httpx

from backend.collectors.base import Collector
from backend.core.models import NormalizedListing


class OlxCollector(Collector):
    source_name = "olx"

    def __init__(
        self,
        endpoint: str | None = None,
        listing_page_url: str | None = None,
        timeout_seconds: float = 20.0,
        max_items: int | None = None,
        max_pages: int | None = None,
        page_size: int = 40,
    ) -> None:
        # TODO(doc-gap): Replace with stable OLX endpoint strategy once source-specific mapping is defined.
        self.endpoint = endpoint or "https://www.olx.pt/api/relevance/v4/search"
        self.listing_page_url = listing_page_url or "https://www.olx.pt/imoveis/apartamento-casa-a-venda/"
        self.timeout_seconds = timeout_seconds
        self.max_items = max_items if max_items is not None else _read_positive_int_env("OLX_MAX_ITEMS")
        self.max_pages = max_pages if max_pages is not None else _read_positive_int_env("OLX_MAX_PAGES")
        self.page_size = page_size

    def fetch(self) -> list[dict[str, Any]]:
        # category_id=1110 targets OLX real-estate bucket used in MVP.
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Referer": self.listing_page_url,
        }
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True, headers=headers) as client:
            try:
                items = self._fetch_api_paginated(client)
                if items:
                    return items
            except Exception:
                pass
            return self._fetch_from_html(client)

    def normalize(self, raw_item: dict[str, Any]) -> NormalizedListing | None:
        title = raw_item.get("title")
        url = raw_item.get("url")
        external_id = str(raw_item.get("id")) if raw_item.get("id") is not None else None
        location = raw_item.get("location") or {}
        map_data = raw_item.get("map") or {}

        price_obj = raw_item.get("price") or {}
        value = price_obj.get("value")
        if value is None:
            value = raw_item.get("price_eur")
        if value is None:
            return None

        try:
            price_eur = float(value)
        except (TypeError, ValueError):
            return None

        return NormalizedListing(
            source=self.source_name,
            listing_type="buy",
            external_id=external_id,
            url=url,
            title=title,
            price_eur=price_eur,
            size_m2=_safe_float(raw_item.get("area")),
            bedrooms=_safe_int(raw_item.get("rooms")),
            bathrooms=_safe_int(raw_item.get("bathrooms")),
            lat=_safe_float(map_data.get("lat")),
            lng=_safe_float(map_data.get("lon")),
            location_text=location.get("city_name"),
            contact_phone=None,
            contact_email=None,
            quality_flags={},
        )

    def _fetch_from_html(self, client: httpx.Client) -> list[dict[str, Any]]:
        urls: list[str] = []
        page = 1
        while self.max_pages is None or page <= self.max_pages:
            listing_response = client.get(_set_page_query(self.listing_page_url, page))
            if listing_response.status_code >= 400:
                break
            listing_html = listing_response.text
            page_urls = _extract_listing_urls(listing_html)
            if not page_urls:
                # Fallback when OLX serves client-rendered cards without static links.
                page_items = _extract_products_from_ld_json(listing_html)
                if not page_items:
                    break
                return page_items[: self.max_items]
            urls.extend(page_urls)
            if len(page_urls) < 10:
                break
            page += 1

        items: list[dict[str, Any]] = []
        seen_urls: dict[str, None] = {}
        for url in urls:
            seen_urls[url] = None
        ordered_urls = list(seen_urls.keys())
        if self.max_items is not None:
            ordered_urls = ordered_urls[: self.max_items]
        for url in ordered_urls:
            try:
                detail_response = client.get(url)
                detail_response.raise_for_status()
                detail_html = detail_response.text
                items.append(_extract_detail_item(url, detail_html))
            except Exception:
                continue
        return items

    def _fetch_api_paginated(self, client: httpx.Client) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        seen: dict[str, None] = {}
        page = 1
        while self.max_pages is None or page <= self.max_pages:
            params = {
                "category_id": "1110",
                "page": page,
                "offset": (page - 1) * self.page_size,
                "limit": self.page_size,
            }
            response = client.get(self.endpoint, params=params)
            response.raise_for_status()
            payload = response.json()
            data = payload.get("data", [])
            rows = [item for item in data if isinstance(item, dict)]
            if not rows:
                break
            for row in rows:
                key = str(row.get("id") or row.get("url") or "")
                if not key or key in seen:
                    continue
                seen[key] = None
                out.append(row)
                if self.max_items is not None and len(out) >= self.max_items:
                    return out
            if len(rows) < self.page_size:
                break
            page += 1
        return out


def _safe_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _extract_listing_urls(page_html: str) -> list[str]:
    seen: dict[str, None] = {}

    href_pattern = re.compile(r'href="(?P<href>/d/[^"]+|https://www\.olx\.pt/d/[^"]+)"', re.IGNORECASE)
    for match in href_pattern.finditer(page_html):
        _add_candidate_url(seen, match.group("href"))

    generic_pattern = re.compile(
        r"(?P<url>https?://www\.olx\.pt/d/[A-Za-z0-9\-_/\.\+]+-ID[A-Za-z0-9]+\.html|/d/[A-Za-z0-9\-_/\.\+]+-ID[A-Za-z0-9]+\.html)",
        re.IGNORECASE,
    )
    for match in generic_pattern.finditer(page_html):
        _add_candidate_url(seen, match.group("url"))

    escaped_pattern = re.compile(
        r'(?P<url>https:\\/\\/www\.olx\.pt\\/d\\/[A-Za-z0-9\\-_/\.]+-ID[A-Za-z0-9]+\.html|\\/d\\/[A-Za-z0-9\\-_/\.]+-ID[A-Za-z0-9]+\.html)',
        re.IGNORECASE,
    )
    for match in escaped_pattern.finditer(page_html):
        unescaped = match.group("url").replace("\\/", "/")
        _add_candidate_url(seen, unescaped)

    return list(seen.keys())


def _add_candidate_url(bucket: dict[str, None], href: str) -> None:
    if "/d/" not in href:
        return
    if "?" in href and "reason=" in href:
        return
    absolute = href if href.startswith("http") else f"https://www.olx.pt{href}"
    cleaned = absolute.split("?")[0].rstrip("/")
    bucket[cleaned] = None


def _extract_detail_item(url: str, detail_html: str) -> dict[str, Any]:
    external_id_match = re.search(r"-ID([A-Za-z0-9]+)\.html", url)
    external_id = external_id_match.group(1) if external_id_match else None

    title = None
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", detail_html, flags=re.IGNORECASE | re.DOTALL)
    if title_match:
        title = _strip_tags(title_match.group(1))

    price_eur = None
    json_price_match = re.search(r'"price"\s*:\s*"?(?P<price>[0-9][0-9\., ]*)"?', detail_html)
    if json_price_match:
        price_eur = _parse_price(json_price_match.group("price"))

    rooms = None
    rooms_match = re.search(r"([0-9]+)\s*(?:quarto|quartos|rooms?)", detail_html, flags=re.IGNORECASE)
    if rooms_match:
        rooms = _safe_int(rooms_match.group(1))

    area = None
    area_match = re.search(r"([0-9]+(?:[\.,][0-9]+)?)\s*m²", detail_html, flags=re.IGNORECASE)
    if area_match:
        area = _safe_float(area_match.group(1).replace(",", "."))

    return {
        "id": external_id,
        "url": url,
        "title": title,
        "price_eur": price_eur,
        "rooms": rooms,
        "area": area,
        "map": {},
        "location": {},
    }


def _parse_price(price_text: str) -> float | None:
    normalized = re.sub(r"[^0-9,\.]", "", price_text)
    if not normalized:
        return None
    normalized = normalized.replace(".", "").replace(",", ".")
    return _safe_float(normalized)


def _strip_tags(raw_html: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", raw_html)
    return html.unescape(re.sub(r"\s+", " ", without_tags)).strip()


def _extract_products_from_ld_json(page_html: str) -> list[dict[str, Any]]:
    blocks = re.findall(
        r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>",
        page_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    items: list[dict[str, Any]] = []
    for block in blocks:
        try:
            payload = json.loads(block)
        except Exception:
            continue

        if not isinstance(payload, dict):
            continue
        if payload.get("@type") != "Product":
            continue

        url = payload.get("url")
        if not isinstance(url, str) or "/d/" not in url:
            continue

        external_id = None
        external_id_match = re.search(r"-ID([A-Za-z0-9]+)\.html", url)
        if external_id_match:
            external_id = external_id_match.group(1)

        offers = payload.get("offers") if isinstance(payload.get("offers"), dict) else {}
        price_eur = _safe_float(offers.get("price")) if offers else None

        items.append(
            {
                "id": external_id,
                "url": url,
                "title": payload.get("name"),
                "price_eur": price_eur,
                "rooms": None,
                "area": None,
                "map": {},
                "location": {},
            }
        )
    return items


def _set_page_query(url: str, page: int) -> str:
    parsed = urlparse(url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    params["page"] = str(page)
    return urlunparse(parsed._replace(query=urlencode(params)))


def _read_positive_int_env(name: str) -> int | None:
    raw = os.environ.get(name)
    if raw is None:
        return None
    try:
        value = int(raw.strip())
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None
