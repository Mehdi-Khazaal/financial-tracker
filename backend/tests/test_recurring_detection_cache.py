"""The Recurring page must not re-run detection when nothing changed."""

from datetime import date, timedelta
from decimal import Decimal

from models.database import RecurringDismissal, Transaction
from services import recurring_detection


def _seed_subscription(db_session, user, account, months=4):
    today = date.today()
    for i in range(months):
        db_session.add(Transaction(
            user_id=user.id, account_id=account.id, amount=Decimal("-15.99"),
            description="Spotify", merchant_key="spotify", payment_channel="online",
            transaction_date=today - timedelta(days=30 * (months - i)),
        ))
    db_session.commit()


def test_second_call_is_served_from_cache(db_session, user, account, monkeypatch):
    _seed_subscription(db_session, user, account)
    today = date.today()
    calls = []
    real = recurring_detection.detect
    monkeypatch.setattr(recurring_detection, "detect", lambda *a, **k: calls.append(1) or real(*a, **k))

    first = recurring_detection.detect_cached(db_session, user.id, today)
    second = recurring_detection.detect_cached(db_session, user.id, today)

    assert [s.name for s in first] == ["Spotify"]
    assert second is first
    assert len(calls) == 1


def test_a_new_transaction_invalidates_the_cache(db_session, user, account, monkeypatch):
    _seed_subscription(db_session, user, account)
    today = date.today()
    calls = []
    real = recurring_detection.detect
    monkeypatch.setattr(recurring_detection, "detect", lambda *a, **k: calls.append(1) or real(*a, **k))

    recurring_detection.detect_cached(db_session, user.id, today)
    db_session.add(Transaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-4.00"),
        description="Coffee", transaction_date=today,
    ))
    db_session.commit()
    recurring_detection.detect_cached(db_session, user.id, today)

    assert len(calls) == 2


def test_a_dismissal_invalidates_the_cache(db_session, user, account):
    _seed_subscription(db_session, user, account)
    today = date.today()

    before = recurring_detection.detect_cached(db_session, user.id, today)
    assert [s.name for s in before] == ["Spotify"]
    db_session.add(RecurringDismissal(user_id=user.id, identity=before[0].identity))
    db_session.commit()

    assert recurring_detection.detect_cached(db_session, user.id, today) == []


def test_cache_is_per_user_and_per_day(db_session, user, account, monkeypatch):
    _seed_subscription(db_session, user, account)
    today = date.today()
    calls = []
    real = recurring_detection.detect
    monkeypatch.setattr(recurring_detection, "detect", lambda *a, **k: calls.append(1) or real(*a, **k))

    recurring_detection.detect_cached(db_session, user.id, today)
    recurring_detection.detect_cached(db_session, user.id, today + timedelta(days=1))
    recurring_detection.detect_cached(db_session, user.id + 1, today)

    assert len(calls) == 3


def test_overview_reuses_detection_across_requests(client, db_session, user, account, auth_headers, monkeypatch):
    _seed_subscription(db_session, user, account)
    calls = []
    real = recurring_detection.detect
    monkeypatch.setattr(recurring_detection, "detect", lambda *a, **k: calls.append(1) or real(*a, **k))

    first = client.get("/recurring/overview", headers=auth_headers)
    second = client.get("/recurring/overview", headers=auth_headers)

    assert first.status_code == second.status_code == 200
    assert [s["name"] for s in second.json()["suggestions"]] == ["Spotify"]
    assert len(calls) == 1
