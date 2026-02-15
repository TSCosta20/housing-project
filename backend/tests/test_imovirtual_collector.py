from backend.collectors.imovirtual.collector import _extract_external_id, _extract_listing_urls


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
