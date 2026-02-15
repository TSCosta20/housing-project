from datetime import date

from backend.core.scoring import build_zone_stats, percentile


def test_percentile_basic():
    values = [1.0, 2.0, 3.0, 4.0]
    assert percentile(values, 0.5) == 2.5


def test_build_zone_stats_marks_min_sample_used():
    stats = build_zone_stats(
        zone_id="z1",
        stats_date=date(2026, 1, 1),
        ratios=[10.0, 12.0, 14.0],
        eligible_rent_count=2,
        median_rent_eur_m2=12.5,
    )
    assert stats.min_sample_used is True
    assert stats.p10_ratio_years is not None
