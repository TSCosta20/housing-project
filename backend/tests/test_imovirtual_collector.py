from backend.collectors.imovirtual.collector import (
    ImovirtualCollector,
    _extract_detail_item,
    _extract_external_id,
    _extract_listing_urls,
)


def test_extract_listing_urls_includes_imovel_and_escaped_variants():
    html = """
    <a href="/pt/imovel/apartamento-t2-IDAAA111"></a>
    <a href="https://www.imovirtual.com/pt/anuncio/moradia-t3-IDBBB222?tracking=1"></a>
    {"url":"https:\\/\\/www.imovirtual.com\\/pt\\/imovel\\/loft-IDCCC333"}
    """

    urls = _extract_listing_urls(html)

    assert "https://www.imovirtual.com/pt/imovel/apartamento-t2-IDAAA111" in urls
    assert "https://www.imovirtual.com/pt/anuncio/moradia-t3-IDBBB222" in urls
    assert "https://www.imovirtual.com/pt/imovel/loft-IDCCC333" in urls


def test_extract_external_id_accepts_query_and_trailing_slash():
    assert _extract_external_id("https://www.imovirtual.com/pt/imovel/t2-IDQWERTY?foo=1") == "QWERTY"
    assert _extract_external_id("https://www.imovirtual.com/pt/anuncio/t2-IDZXCVBN/") == "ZXCVBN"


def test_extract_detail_item_parses_geo_coordinates():
    html = """
    <h1>Apartamento T2</h1>
    <script type="application/ld+json">
    {"price":"250000","addressLocality":"Campolide","geo":{"latitude":38.73,"longitude":-9.16}}
    </script>
    """
    item = _extract_detail_item(
        "https://www.imovirtual.com/pt/imovel/apartamento-t2-IDABC123",
        html,
        listing_type="buy",
    )
    assert item is not None
    assert item["lat"] == 38.73
    assert item["lng"] == -9.16


def test_normalize_uses_lat_lng_when_present():
    collector = ImovirtualCollector(max_pages=1, max_items=1)
    normalized = collector.normalize(
        {
            "listing_type": "buy",
            "external_id": "XYZ123",
            "url": "https://www.imovirtual.com/pt/imovel/t2-IDXYZ123",
            "title": "T2",
            "price": "200000",
            "lat": 38.74,
            "lng": -9.14,
        }
    )
    assert normalized is not None
    assert normalized.lat == 38.74
    assert normalized.lng == -9.14
