from __future__ import annotations

import json
import os
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from typing import Any

import httpx

from backend.collectors.base import Collector
from backend.core.models import NormalizedListing


class ImovirtualCollector(Collector):
    source_name = "imovirtual"

    def __init__(
        self,
        buy_search_urls: list[str] | None = None,
        rent_search_urls: list[str] | None = None,
        timeout_seconds: float = 20.0,
        max_items: int | None = None,
        max_pages: int | None = None,
    ) -> None:
        self.buy_search_urls = buy_search_urls or [
            "https://www.imovirtual.com/pt/resultados/comprar/apartamento/todo-o-pais",
            "https://www.imovirtual.com/pt/resultados/comprar/moradia/todo-o-pais",
        ]
        self.rent_search_urls = rent_search_urls or [
            "https://www.imovirtual.com/pt/resultados/arrendar/apartamento/todo-o-pais",
            "https://www.imovirtual.com/pt/resultados/arrendar/moradia/todo-o-pais",
        ]
        self.timeout_seconds = timeout_seconds
        self.max_items = max_items if max_items is not None else _read_positive_int_env("IMOVIRTUAL_MAX_ITEMS")
        self.max_pages = max_pages if max_pages is not None else _read_positive_int_env("IMOVIRTUAL_MAX_PAGES")

    def fetch(self) -> list[dict[str, Any]]:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        }
        items: list[dict[str, Any]] = []
        seen: dict[str, None] = {}
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True, headers=headers) as client:
            for listing_type, search_urls in (
                ("buy", self.buy_search_urls),
                ("rent", self.rent_search_urls),
            ):
                for search_url in search_urls:
                    page = 1
                    while self.max_pages is None or page <= self.max_pages:
                        response = client.get(_set_page_query(search_url, page))
                        if response.status_code >= 400:
                            break
                        html = response.text
                        page_items = _extract_offers_from_schema_graph(html, listing_type=listing_type)
                        if not page_items:
                            urls = _extract_listing_urls(html)
                            page_items = _fetch_from_details(client, urls, listing_type=listing_type)
                        if not page_items:
                            break
                        added = 0
                        for item in page_items:
                            key = str(item.get("url") or item.get("external_id") or "")
                            if not key or key in seen:
                                continue
                            seen[key] = None
                            items.append(item)
                            added += 1
                            if self.max_items is not None and len(items) >= self.max_items:
                                return items
                        # Stop paging when no new unique records are discovered.
                        if added == 0:
                            break
                        page += 1
        return items

    def normalize(self, raw_item: dict[str, Any]) -> NormalizedListing | None:
        price = _safe_float(raw_item.get("price"))
        if price is None:
            return None

        return NormalizedListing(
            source=self.source_name,
            listing_type=str(raw_item.get("listing_type") or "buy"),
            external_id=raw_item.get("external_id"),
            url=raw_item.get("url"),
            title=raw_item.get("title"),
            price_eur=price,
            size_m2=_safe_float(raw_item.get("size_m2")),
            bedrooms=_safe_int(raw_item.get("bedrooms")),
            bathrooms=None,
            lat=_safe_float(raw_item.get("lat") or raw_item.get("latitude")),
            lng=_safe_float(raw_item.get("lng") or raw_item.get("lon") or raw_item.get("longitude")),
            location_text=raw_item.get("location_text"),
            contact_phone=None,
            contact_email=None,
            quality_flags={},
        )


def _extract_offers_from_schema_graph(page_html: str, listing_type: str) -> list[dict[str, Any]]:
    blocks = re.findall(
        r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>",
        page_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    result: list[dict[str, Any]] = []
    for block in blocks:
        try:
            payload = json.loads(block)
        except Exception:
            continue
        for offer in _iter_offer_like_nodes(payload):
            url = offer.get("url")
            if not isinstance(url, str):
                continue
            if "/pt/anuncio/" not in url and "/pt/imovel/" not in url:
                continue

            item_offered = offer.get("itemOffered") if isinstance(offer.get("itemOffered"), dict) else {}
            floor_size = item_offered.get("floorSize") if isinstance(item_offered.get("floorSize"), dict) else {}
            address = item_offered.get("address") if isinstance(item_offered.get("address"), dict) else {}
            geo = item_offered.get("geo") if isinstance(item_offered.get("geo"), dict) else {}
            if not geo:
                geo = offer.get("geo") if isinstance(offer.get("geo"), dict) else {}
            price = offer.get("price")
            if price is None:
                offers_obj = offer.get("offers") if isinstance(offer.get("offers"), dict) else {}
                price = offers_obj.get("price")

            result.append(
                {
                    "listing_type": listing_type,
                    "external_id": _extract_external_id(url),
                    "url": url,
                    "title": offer.get("name") or item_offered.get("name"),
                    "price": price,
                    "size_m2": floor_size.get("value") or offer.get("size_m2"),
                    "bedrooms": item_offered.get("numberOfRooms") or offer.get("numberOfRooms"),
                    "location_text": address.get("addressLocality") or offer.get("location_text"),
                    "lat": geo.get("latitude") or offer.get("lat"),
                    "lng": geo.get("longitude") or offer.get("lng") or offer.get("lon"),
                }
            )
    return result


def _extract_external_id(url: str) -> str | None:
    match = re.search(r"-ID([A-Za-z0-9]+)(?:$|[/?#])", url)
    if match:
        return match.group(1)
    return None


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


def _iter_offer_like_nodes(payload: Any) -> list[dict[str, Any]]:
    stack: list[Any] = [payload]
    out: list[dict[str, Any]] = []
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        stack.extend(node.values())
        node_type = str(node.get("@type") or "")
        if "Offer" in node_type or "Product" in node_type or "Residence" in node_type:
            out.append(node)
            continue
        if isinstance(node.get("url"), str) and (
            node.get("price") is not None
            or isinstance(node.get("offers"), dict)
            or isinstance(node.get("itemOffered"), dict)
        ):
            out.append(node)
    return out


def _set_page_query(url: str, page: int) -> str:
    parsed = urlparse(url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    params["page"] = str(page)
    return urlunparse(parsed._replace(query=urlencode(params)))


def _extract_listing_urls(page_html: str) -> list[str]:
    seen: dict[str, None] = {}
    patterns = [
        re.compile(
            r'href="(?P<href>/pt/(?:anuncio|imovel)/[^"]+|https://www\.imovirtual\.com/pt/(?:anuncio|imovel)/[^"]+)"',
            re.I,
        ),
        re.compile(
            r"(?P<href>https?://www\.imovirtual\.com/pt/(?:anuncio|imovel)/[^\s\"'<>]+|/pt/(?:anuncio|imovel)/[^\s\"'<>]+)",
            re.I,
        ),
        re.compile(
            r"(?P<href>https:\\/\\/www\.imovirtual\.com\\/pt\\/(?:anuncio|imovel)\\/[^\"'<> ]+|\\/pt\\/(?:anuncio|imovel)\\/[^\"'<> ]+)",
            re.I,
        ),
    ]
    for pattern in patterns:
        for match in pattern.finditer(page_html):
            _add_listing_url_candidate(seen, match.group("href"))
    return list(seen.keys())


def _add_listing_url_candidate(bucket: dict[str, None], href: str) -> None:
    raw = href.replace("\\/", "/")
    absolute = raw if raw.startswith("http") else f"https://www.imovirtual.com{raw}"
    cleaned = absolute.split("?")[0].rstrip("/")
    lowered = cleaned.lower()
    if "/pt/anuncio/" not in lowered and "/pt/imovel/" not in lowered:
        return
    bucket[cleaned] = None


def _fetch_from_details(client: httpx.Client, urls: list[str], listing_type: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for url in urls:
        try:
            response = client.get(url)
            if response.status_code >= 400:
                continue
            detail_html = response.text
            item = _extract_detail_item(url, detail_html, listing_type=listing_type)
            if item is not None:
                items.append(item)
        except Exception:
            continue
    return items


def _extract_detail_item(url: str, detail_html: str, listing_type: str) -> dict[str, Any] | None:
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", detail_html, flags=re.IGNORECASE | re.DOTALL)
    title = _strip_tags(title_match.group(1)) if title_match else None

    price = None
    for pattern in (
        r'"price"\s*:\s*"?(?P<value>[0-9][0-9\., ]*)"?',
        r'content="(?P<value>[0-9][0-9\., ]*)\s*EUR"',
    ):
        match = re.search(pattern, detail_html, flags=re.IGNORECASE)
        if match:
            price = _parse_price(match.group("value"))
            if price is not None:
                break
    if price is None:
        return None

    rooms = None
    rooms_match = re.search(r"([0-9]+)\s*(?:quarto|quartos|assoalhadas|rooms?)", detail_html, flags=re.IGNORECASE)
    if rooms_match:
        rooms = _safe_int(rooms_match.group(1))

    size_m2 = None
    area_match = re.search(r"([0-9]+(?:[\.,][0-9]+)?)\s*m²", detail_html, flags=re.IGNORECASE)
    if area_match:
        size_m2 = _safe_float(area_match.group(1).replace(",", "."))

    location_text = None
    location_match = re.search(r'"addressLocality"\s*:\s*"(?P<loc>[^"]+)"', detail_html)
    if location_match:
        location_text = location_match.group("loc")
    else:
        region_match = re.search(r'"addressRegion"\s*:\s*"(?P<region>[^"]+)"', detail_html)
        if region_match:
            location_text = region_match.group("region")

    lat = None
    lng = None
    geo_match = re.search(
        r'"geo"\s*:\s*\{(?P<geo>.*?)\}',
        detail_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if geo_match:
        geo_block = geo_match.group("geo")
        lat_match = re.search(
            r'"latitude"\s*:\s*(?P<lat>-?[0-9]+(?:\.[0-9]+)?)',
            geo_block,
            flags=re.IGNORECASE,
        )
        lng_match = re.search(
            r'"longitude"\s*:\s*(?P<lng>-?[0-9]+(?:\.[0-9]+)?)',
            geo_block,
            flags=re.IGNORECASE,
        )
        if lat_match:
            lat = _safe_float(lat_match.group("lat"))
        if lng_match:
            lng = _safe_float(lng_match.group("lng"))

    return {
        "listing_type": listing_type,
        "external_id": _extract_external_id(url),
        "url": url,
        "title": title,
        "price": price,
        "size_m2": size_m2,
        "bedrooms": rooms,
        "location_text": location_text,
        "lat": lat,
        "lng": lng,
    }


def _parse_price(price_text: str) -> float | None:
    normalized = re.sub(r"[^0-9,\.]", "", price_text)
    if not normalized:
        return None
    normalized = normalized.replace(".", "").replace(",", ".")
    return _safe_float(normalized)


def _strip_tags(raw_html: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", raw_html)
    return re.sub(r"\s+", " ", without_tags).strip()


def _read_positive_int_env(name: str) -> int | None:
    raw = os.environ.get(name)
    if raw is None:
        return None
    try:
        value = int(raw.strip())
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None
