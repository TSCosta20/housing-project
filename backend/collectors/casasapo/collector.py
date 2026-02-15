from __future__ import annotations

import json
import logging
import os
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from typing import Any

import httpx
try:
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except Exception:  # noqa: BLE001
    sync_playwright = None
    PlaywrightTimeoutError = Exception

from backend.collectors.base import Collector
from backend.core.models import NormalizedListing

LOGGER = logging.getLogger(__name__)


class CasaSapoCollector(Collector):
    source_name = "casasapo"

    def __init__(
        self,
        buy_search_urls: list[str] | None = None,
        rent_search_urls: list[str] | None = None,
        timeout_seconds: float = 20.0,
        max_items: int | None = None,
        max_pages: int | None = None,
    ) -> None:
        self.buy_search_urls = buy_search_urls or [
            "https://casa.sapo.pt/comprar-apartamentos/portugal/",
            "https://casa.sapo.pt/comprar-moradias/portugal/",
        ]
        self.rent_search_urls = rent_search_urls or [
            "https://casa.sapo.pt/arrendar-apartamentos/portugal/",
            "https://casa.sapo.pt/arrendar-moradias/portugal/",
        ]
        self.timeout_seconds = timeout_seconds
        self.max_items = max_items if max_items is not None else _read_positive_int_env("CASASAPO_MAX_ITEMS")
        self.max_pages = max_pages if max_pages is not None else _read_positive_int_env("CASASAPO_MAX_PAGES")

    def fetch(self) -> list[dict[str, Any]]:
        browser_items = self._fetch_with_playwright()
        if browser_items:
            return browser_items

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        }
        out: list[dict[str, Any]] = []
        seen: dict[str, None] = {}
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True, headers=headers) as client:
            for listing_type, search_urls in (
                ("buy", self.buy_search_urls),
                ("rent", self.rent_search_urls),
            ):
                for search_url in search_urls:
                    page = 1
                    while self.max_pages is None or page <= self.max_pages:
                        page_url = _set_page_query(search_url, page)
                        try:
                            response = client.get(page_url)
                        except Exception:
                            break
                        if response.status_code >= 400:
                            break
                        page_html = response.text
                        page_items = _extract_items_from_ld_json(page_html, listing_type)
                        if not page_items:
                            urls = _extract_listing_urls(page_html)
                            page_items = _fetch_from_details(client, urls, listing_type=listing_type)
                        if not page_items:
                            break
                        new_count = 0
                        for item in page_items:
                            key = str(item.get("url") or item.get("external_id") or "")
                            if not key or key in seen:
                                continue
                            seen[key] = None
                            out.append(item)
                            new_count += 1
                            if self.max_items is not None and len(out) >= self.max_items:
                                return out
                        if new_count == 0:
                            break
                        page += 1
        return out

    def _fetch_with_playwright(self) -> list[dict[str, Any]]:
        if sync_playwright is None:
            LOGGER.warning("CasaSapo Playwright unavailable; falling back to static HTTP collector.")
            return []
        out: list[dict[str, Any]] = []
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                    ),
                    locale="pt-PT",
                )
                context.route(
                    "**/*",
                    lambda route: route.abort()
                    if route.request.resource_type in {"image", "media", "font"}
                    else route.continue_(),
                )
                page = context.new_page()

                for listing_type, search_urls in (
                    ("buy", self.buy_search_urls),
                    ("rent", self.rent_search_urls),
                ):
                    seen_urls: dict[str, None] = {}
                    for search_url in search_urls:
                        stale_pages = 0
                        page_number = 1
                        while self.max_pages is None or page_number <= self.max_pages:
                            page_url = _set_page_query(search_url, page_number)
                            try:
                                page.goto(page_url, wait_until="domcontentloaded", timeout=int(self.timeout_seconds * 1000))
                                page.wait_for_timeout(900)
                            except PlaywrightTimeoutError:
                                break
                            except Exception:
                                break

                            hrefs = page.eval_on_selector_all("a[href]", "els => els.map(el => el.href)")
                            before = len(seen_urls)
                            for href in hrefs:
                                if not isinstance(href, str):
                                    continue
                                if not _is_listing_url(href):
                                    continue
                                seen_urls[_clean_url(href)] = None
                            if len(seen_urls) == before:
                                stale_pages += 1
                            else:
                                stale_pages = 0
                            if stale_pages >= 2:
                                break
                            page_number += 1

                    for url in list(seen_urls.keys()):
                        if self.max_items is not None and len(out) >= self.max_items:
                            browser.close()
                            return out
                        try:
                            page.goto(url, wait_until="domcontentloaded", timeout=int(self.timeout_seconds * 1000))
                            page.wait_for_timeout(400)
                            item = _extract_detail_item(url, page.content(), listing_type=listing_type)
                            if item is not None:
                                out.append(item)
                        except Exception:
                            continue

                browser.close()
        except Exception as exc:
            LOGGER.warning("CasaSapo Playwright collector failed, fallback to HTTP collector: %s", exc)
            return []
        return out

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
            bathrooms=_safe_int(raw_item.get("bathrooms")),
            lat=None,
            lng=None,
            location_text=raw_item.get("location_text"),
            contact_phone=None,
            contact_email=None,
            quality_flags={},
        )


def _extract_items_from_ld_json(page_html: str, listing_type: str) -> list[dict[str, Any]]:
    blocks = re.findall(
        r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>",
        page_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    out: list[dict[str, Any]] = []
    for block in blocks:
        try:
            payload = json.loads(block)
        except Exception:
            continue
        for node in _iter_nodes(payload):
            if not isinstance(node, dict):
                continue
            url = node.get("url")
            if not isinstance(url, str):
                continue
            if "casa.sapo.pt" not in url:
                continue
            if "/imovel/" not in url and "/anuncio/" not in url:
                continue
            offers = node.get("offers") if isinstance(node.get("offers"), dict) else {}
            address = node.get("address") if isinstance(node.get("address"), dict) else {}
            floor_size = node.get("floorSize") if isinstance(node.get("floorSize"), dict) else {}
            out.append(
                {
                    "listing_type": listing_type,
                    "external_id": _extract_external_id(url),
                    "url": url,
                    "title": node.get("name"),
                    "price": node.get("price") or offers.get("price"),
                    "size_m2": floor_size.get("value"),
                    "bedrooms": node.get("numberOfRooms"),
                    "bathrooms": node.get("numberOfBathroomsTotal"),
                    "location_text": address.get("addressLocality") or address.get("addressRegion"),
                }
            )
    return out


def _extract_listing_urls(page_html: str) -> list[str]:
    seen: dict[str, None] = {}
    patterns = [
        re.compile(
            r'href="(?P<href>/[^"]*(?:comprar|arrendar)-[^"]*-ID[0-9A-Za-z]+[^"]*|https://casa\.sapo\.pt/[^"]*(?:comprar|arrendar)-[^"]*-ID[0-9A-Za-z]+[^"]*)"',
            flags=re.IGNORECASE,
        ),
        re.compile(
            r"(?P<url>https://casa\.sapo\.pt/[^\"'\s<>]*(?:comprar|arrendar)-[^\"'\s<>]*-ID[0-9A-Za-z]+[^\"'\s<>]*)",
            flags=re.IGNORECASE,
        ),
    ]
    for pattern in patterns:
        for match in pattern.finditer(page_html):
            href = match.groupdict().get("href") or match.groupdict().get("url") or ""
            absolute = href if href.startswith("http") else f"https://casa.sapo.pt{href}"
            cleaned = absolute.split("?")[0].rstrip("/")
            seen[cleaned] = None
    return list(seen.keys())


def _fetch_from_details(client: httpx.Client, urls: list[str], listing_type: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for url in urls:
        try:
            response = client.get(url)
            if response.status_code >= 400:
                continue
            item = _extract_detail_item(url, response.text, listing_type=listing_type)
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

    size_m2 = None
    area_match = re.search(r"([0-9]+(?:[\.,][0-9]+)?)\s*m²", detail_html, flags=re.IGNORECASE)
    if area_match:
        size_m2 = _safe_float(area_match.group(1).replace(",", "."))

    bedrooms = None
    rooms_match = re.search(r"([0-9]+)\s*(?:quarto|quartos|assoalhadas|rooms?)", detail_html, flags=re.IGNORECASE)
    if rooms_match:
        bedrooms = _safe_int(rooms_match.group(1))

    location_text = None
    location_match = re.search(r'"addressLocality"\s*:\s*"(?P<loc>[^"]+)"', detail_html)
    if location_match:
        location_text = location_match.group("loc")

    return {
        "listing_type": listing_type,
        "external_id": _extract_external_id(url),
        "url": url,
        "title": title,
        "price": price,
        "size_m2": size_m2,
        "bedrooms": bedrooms,
        "bathrooms": None,
        "location_text": location_text,
    }


def _iter_nodes(payload: Any) -> list[Any]:
    stack: list[Any] = [payload]
    out: list[Any] = []
    while stack:
        node = stack.pop()
        out.append(node)
        if isinstance(node, dict):
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return out


def _extract_external_id(url: str) -> str | None:
    match = re.search(r"-ID([A-Za-z0-9]+)", url, flags=re.IGNORECASE)
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


def _set_page_query(url: str, page: int) -> str:
    parsed = urlparse(url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    # Casa Sapo uses pn as paging parameter in many listings pages.
    params["pn"] = str(page)
    return urlunparse(parsed._replace(query=urlencode(params)))


def _is_listing_url(url: str) -> bool:
    lowered = url.lower()
    if "casa.sapo.pt" not in lowered:
        return False
    if "/comprar-" not in lowered and "/arrendar-" not in lowered and "/imovel/" not in lowered:
        return False
    return "-id" in lowered or "/imovel/" in lowered


def _clean_url(url: str) -> str:
    return url.split("?")[0].rstrip("/")


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
