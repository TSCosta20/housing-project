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
        listing_page_urls: list[str] | None = None,
        timeout_seconds: float = 20.0,
        max_items: int | None = None,
        max_pages: int | None = None,
        page_size: int = 40,
    ) -> None:
        # TODO(doc-gap): Replace with stable OLX endpoint strategy once source-specific mapping is defined.
        self.endpoint = endpoint or "https://www.olx.pt/api/relevance/v4/search"
        primary_listing_url = listing_page_url or "https://www.olx.pt/imoveis/apartamento-casa-a-venda/"
        configured_urls = listing_page_urls or [primary_listing_url, "https://www.olx.pt/imoveis/"]
        deduped_urls: list[str] = []
        for url in [primary_listing_url, *configured_urls]:
            cleaned = str(url or "").strip()
            if cleaned and cleaned not in deduped_urls:
                deduped_urls.append(cleaned)
        self.listing_page_urls = deduped_urls
        self.listing_page_url = self.listing_page_urls[0]
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
        if value is None and isinstance(price_obj.get("regularPrice"), dict):
            value = price_obj.get("regularPrice", {}).get("value")
        if value is None and isinstance(price_obj.get("amount"), dict):
            value = price_obj.get("amount", {}).get("value")
        if value is None:
            value = raw_item.get("price_eur")
        if value is None and isinstance(price_obj.get("displayValue"), str):
            value = _parse_price(price_obj.get("displayValue", ""))
        if value is None:
            return None

        try:
            price_eur = float(value)
        except (TypeError, ValueError):
            return None

        area = raw_item.get("area")
        if area is None:
            area = _extract_param_float(raw_item.get("params"), keys=("area_util", "area_bruta", "area_total"))

        rooms = raw_item.get("rooms")
        if rooms is None:
            rooms = _extract_param_int(raw_item.get("params"), keys=("quartos", "numero_quartos"))
        if rooms is None:
            rooms = _extract_rooms_from_tipology(raw_item.get("params"))

        bathrooms = raw_item.get("bathrooms")
        if bathrooms is None:
            bathrooms = _extract_param_int(raw_item.get("params"), keys=("casas_de_banho", "bathrooms"))

        return NormalizedListing(
            source=self.source_name,
            listing_type=_infer_listing_type(raw_item),
            external_id=external_id,
            url=url,
            title=title,
            price_eur=price_eur,
            size_m2=_safe_float(area),
            bedrooms=_safe_int(rooms),
            bathrooms=_safe_int(bathrooms),
            lat=_safe_float(map_data.get("lat")),
            lng=_safe_float(map_data.get("lon") or map_data.get("lng")),
            location_text=location.get("city_name") or location.get("cityName") or location.get("pathName"),
            contact_phone=None,
            contact_email=None,
            quality_flags={},
        )

    def _fetch_from_html(self, client: httpx.Client) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        seen: dict[str, None] = {}

        for listing_page_url in self.listing_page_urls:
            page = 1
            stale_pages = 0
            while self.max_pages is None or page <= self.max_pages:
                listing_response = client.get(_set_page_query(listing_page_url, page))
                if listing_response.status_code >= 400:
                    break
                listing_html = listing_response.text
                listing_type = _listing_type_from_search_url(listing_page_url)

                prerender_items, total_pages_hint = _extract_items_from_prerendered_state(
                    listing_html, listing_type=listing_type
                )
                if prerender_items:
                    added = _append_unique_items(items, prerender_items, seen, max_items=self.max_items)
                    if self.max_items is not None and len(items) >= self.max_items:
                        return items
                    stale_pages = stale_pages + 1 if added == 0 else 0
                    if stale_pages >= 2:
                        break
                    if total_pages_hint is not None and page >= total_pages_hint:
                        break
                    page += 1
                    continue

                page_urls = _extract_listing_urls(listing_html)
                page_items: list[dict[str, Any]]
                if page_urls:
                    page_items = _fetch_from_details(client, page_urls, listing_type=listing_type)
                else:
                    # Fallback when OLX serves cards only through JSON-LD snippets.
                    page_items = _extract_products_from_ld_json(listing_html, listing_type=listing_type)
                if not page_items:
                    break

                added = _append_unique_items(items, page_items, seen, max_items=self.max_items)
                if self.max_items is not None and len(items) >= self.max_items:
                    return items
                stale_pages = stale_pages + 1 if added == 0 else 0
                if stale_pages >= 2:
                    break
                page += 1
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


def _fetch_from_details(client: httpx.Client, urls: list[str], listing_type: str | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for url in urls:
        try:
            response = client.get(url)
            if response.status_code >= 400:
                continue
            items.append(_extract_detail_item(url, response.text, listing_type=listing_type))
        except Exception:
            continue
    return items


def _extract_detail_item(url: str, detail_html: str, listing_type: str | None = None) -> dict[str, Any]:
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

    item: dict[str, Any] = {
        "id": external_id,
        "url": url,
        "title": title,
        "price_eur": price_eur,
        "rooms": rooms,
        "area": area,
        "map": {},
        "location": {},
    }
    if listing_type:
        item["listing_type"] = listing_type
    return item


def _parse_price(price_text: str) -> float | None:
    normalized = re.sub(r"[^0-9,\.]", "", price_text)
    if not normalized:
        return None
    normalized = normalized.replace(".", "").replace(",", ".")
    return _safe_float(normalized)


def _strip_tags(raw_html: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", raw_html)
    return html.unescape(re.sub(r"\s+", " ", without_tags)).strip()


def _extract_products_from_ld_json(page_html: str, listing_type: str | None = None) -> list[dict[str, Any]]:
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

        item: dict[str, Any] = {
            "id": external_id,
            "url": url,
            "title": payload.get("name"),
            "price_eur": price_eur,
            "rooms": None,
            "area": None,
            "map": {},
            "location": {},
        }
        if listing_type:
            item["listing_type"] = listing_type
        items.append(item)
    return items


def _extract_items_from_prerendered_state(
    page_html: str, listing_type: str | None
) -> tuple[list[dict[str, Any]], int | None]:
    listing = _extract_prerendered_listing_state(page_html)
    if listing is None:
        return [], None
    ads = listing.get("ads")
    if not isinstance(ads, list):
        return [], _safe_int(listing.get("totalPages"))

    out: list[dict[str, Any]] = []
    for ad in ads:
        if not isinstance(ad, dict):
            continue
        url = ad.get("url") or ad.get("externalUrl")
        if not isinstance(url, str):
            continue
        cleaned_url = url.split("?")[0].rstrip("/")
        if "/d/" not in cleaned_url:
            continue

        location = ad.get("location") if isinstance(ad.get("location"), dict) else {}
        map_data = ad.get("map") if isinstance(ad.get("map"), dict) else {}
        item: dict[str, Any] = {
            "id": ad.get("id"),
            "url": cleaned_url,
            "title": ad.get("title"),
            "description": ad.get("description"),
            "price": ad.get("price"),
            "area": _extract_param_float(ad.get("params"), keys=("area_util", "area_bruta", "area_total")),
            "rooms": _extract_param_int(ad.get("params"), keys=("quartos", "numero_quartos"))
            or _extract_rooms_from_tipology(ad.get("params")),
            "bathrooms": _extract_param_int(ad.get("params"), keys=("casas_de_banho", "bathrooms")),
            "location": {
                "city_name": location.get("cityName") or location.get("city_name"),
                "cityName": location.get("cityName") or location.get("city_name"),
                "pathName": location.get("pathName") or location.get("path_name"),
            },
            "map": {
                "lat": map_data.get("lat"),
                "lon": map_data.get("lon") or map_data.get("lng"),
            },
            "params": ad.get("params"),
        }
        if listing_type:
            item["listing_type"] = listing_type
        out.append(item)
    return out, _safe_int(listing.get("totalPages"))


def _extract_prerendered_listing_state(page_html: str) -> dict[str, Any] | None:
    needle = "window.__PRERENDERED_STATE__="
    start = page_html.find(needle)
    if start < 0:
        return None
    cursor = start + len(needle)
    while cursor < len(page_html) and page_html[cursor].isspace():
        cursor += 1
    if cursor >= len(page_html) or page_html[cursor] != "\"":
        return None

    raw_json_string = _extract_js_quoted_string(page_html, start_index=cursor)
    if raw_json_string is None:
        return None
    try:
        decoded_payload = json.loads(f"\"{raw_json_string}\"")
        payload = json.loads(decoded_payload)
    except Exception:
        return None
    listing_root = payload.get("listing") if isinstance(payload, dict) else None
    if not isinstance(listing_root, dict):
        return None
    listing = listing_root.get("listing")
    return listing if isinstance(listing, dict) else None


def _extract_js_quoted_string(source: str, start_index: int) -> str | None:
    if start_index < 0 or start_index >= len(source) or source[start_index] != "\"":
        return None
    cursor = start_index + 1
    out: list[str] = []
    escape = False
    while cursor < len(source):
        char = source[cursor]
        if escape:
            out.append("\\" + char)
            escape = False
        else:
            if char == "\\":
                escape = True
            elif char == "\"":
                return "".join(out)
            else:
                out.append(char)
        cursor += 1
    return None


def _append_unique_items(
    bucket: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    seen: dict[str, None],
    max_items: int | None,
) -> int:
    added = 0
    for item in candidates:
        key = str(item.get("id") or item.get("url") or "")
        if not key or key in seen:
            continue
        seen[key] = None
        bucket.append(item)
        added += 1
        if max_items is not None and len(bucket) >= max_items:
            return added
    return added


def _extract_param_float(params: Any, keys: tuple[str, ...]) -> float | None:
    value = _extract_param_value(params, keys)
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return _safe_float(value)
    text = str(value)
    for pattern in (
        r"([0-9]+(?:[.,][0-9]+)?)\s*m²",
        r"([0-9]+(?:[.,][0-9]+)?)",
    ):
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return _safe_float(match.group(1).replace(",", "."))
    return None


def _extract_param_int(params: Any, keys: tuple[str, ...]) -> int | None:
    value = _extract_param_value(params, keys)
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return _safe_int(value)
    match = re.search(r"([0-9]+)", str(value))
    if match:
        return _safe_int(match.group(1))
    return None


def _extract_rooms_from_tipology(params: Any) -> int | None:
    tipology = _extract_param_value(params, keys=("tipologia", "typology", "rooms"))
    if tipology is None:
        return None
    match = re.search(r"(?:\bT)?([0-9]+)\b", str(tipology), flags=re.IGNORECASE)
    if match:
        return _safe_int(match.group(1))
    return None


def _extract_param_value(params: Any, keys: tuple[str, ...]) -> Any:
    if not isinstance(params, list):
        return None
    wanted = {key.strip().lower() for key in keys}
    for param in params:
        if not isinstance(param, dict):
            continue
        key = str(param.get("key") or "").strip().lower()
        if key not in wanted:
            continue
        for field in ("normalizedValue", "value", "name"):
            if param.get(field) not in (None, ""):
                return param.get(field)
    return None


def _listing_type_from_search_url(url: str) -> str | None:
    lowered = url.lower()
    if any(token in lowered for token in ("arrendar", "arrendamento", "alugar", "para-arrendar", "para-alugar")):
        return "rent"
    if any(token in lowered for token in ("venda", "comprar", "a-venda", "para-venda")):
        return "buy"
    return None


def _infer_listing_type(raw_item: dict[str, Any]) -> str:
    explicit = str(raw_item.get("listing_type") or "").strip().lower()
    if explicit in {"buy", "rent"}:
        return explicit
    signals = " ".join(
        str(raw_item.get(field) or "")
        for field in (
            "url",
            "title",
            "description",
        )
    ).lower()
    if any(token in signals for token in ("arrendar", "arrendamento", "arrendo", "alugar", "aluguer", "renda")):
        return "rent"
    return "buy"


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
