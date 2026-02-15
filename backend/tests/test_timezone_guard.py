from datetime import datetime, timezone

from backend.core.timezone_guard import should_run_lisbon_5am


def test_should_run_lisbon_5am_true():
    dt = datetime(2026, 1, 15, 5, 10, tzinfo=timezone.utc)
    assert should_run_lisbon_5am(dt, target_hour=5) is True


def test_should_run_lisbon_5am_false():
    dt = datetime(2026, 1, 15, 8, 0, tzinfo=timezone.utc)
    assert should_run_lisbon_5am(dt, target_hour=5) is False
