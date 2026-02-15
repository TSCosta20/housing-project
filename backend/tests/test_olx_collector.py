import json

from backend.collectors.olx.collector import (
    _extract_items_from_prerendered_state,
    _infer_listing_type,
    _listing_type_from_search_url,
)


def test_extract_items_from_prerendered_state_parses_ads():
    payload = {
        "listing": {
            "listing": {
                "totalPages": 7,
                "ads": [
                    {
                        "id": 123,
                        "url": "https://www.olx.pt/d/anuncio/t2-com-varanda-IDABC123.html?reason=listing",
                        "title": "Apartamento T2",
                        "description": "Apartamento para venda em Lisboa",
                        "price": {"regularPrice": {"value": 250000}},
                        "params": [
                            {"key": "tipologia", "value": "T2"},
                            {"key": "area_util", "value": "91 m²"},
                            {"key": "casas_de_banho", "value": "2"},
                        ],
                        "location": {"cityName": "Lisboa", "pathName": "Lisboa, Lisboa"},
                        "map": {"lat": 38.72, "lon": -9.14},
                    }
                ],
            }
        }
    }
    html = f"<script>window.__PRERENDERED_STATE__= {json.dumps(json.dumps(payload))};</script>"

    items, total_pages = _extract_items_from_prerendered_state(html, listing_type="buy")

    assert total_pages == 7
    assert len(items) == 1
    assert items[0]["id"] == 123
    assert items[0]["url"] == "https://www.olx.pt/d/anuncio/t2-com-varanda-IDABC123.html"
    assert items[0]["listing_type"] == "buy"
    assert items[0]["area"] == 91.0
    assert items[0]["rooms"] == 2
    assert items[0]["bathrooms"] == 2


def test_infer_listing_type_detects_rent():
    assert _infer_listing_type({"title": "Apartamento para arrendar"}) == "rent"
    assert _infer_listing_type({"title": "Apartamento T2 em venda"}) == "buy"


def test_listing_type_from_search_url_matches_venda_routes():
    assert _listing_type_from_search_url("https://www.olx.pt/imoveis/apartamento-casa-a-venda/") == "buy"
