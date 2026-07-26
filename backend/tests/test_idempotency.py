"""Idempotency-Key middleware behavior."""

from datetime import timedelta
from uuid import uuid4

from models.database import IdempotencyKey, utc_now


def test_repeat_post_with_same_key_replays_response(client, db_session, user, auth_headers, account):
    key = str(uuid4())
    payload = {
        "account_id": account.id,
        "amount": -12.50,
        "description": "Lunch",
        "transaction_date": "2026-03-10",
    }
    headers = {**auth_headers, "Idempotency-Key": key}

    first = client.post("/transactions/", json=payload, headers=headers)
    assert first.status_code == 201
    first_id = first.json()["id"]

    second = client.post("/transactions/", json=payload, headers=headers)
    assert second.status_code == 201
    # Same response body — no new row created.
    assert second.json()["id"] == first_id

    stored = db_session.query(IdempotencyKey).filter_by(user_id=user.id, key=key).count()
    assert stored == 1


def test_reusing_key_with_different_body_returns_409(client, auth_headers, account):
    key = str(uuid4())
    headers = {**auth_headers, "Idempotency-Key": key}

    first_payload = {
        "account_id": account.id,
        "amount": -5,
        "description": "Coffee",
        "transaction_date": "2026-03-10",
    }
    assert client.post("/transactions/", json=first_payload, headers=headers).status_code == 201

    second_payload = {**first_payload, "amount": -999}
    conflict = client.post("/transactions/", json=second_payload, headers=headers)
    assert conflict.status_code == 409
    assert "Idempotency-Key" in conflict.json()["detail"]


def test_missing_key_header_bypasses_idempotency(client, auth_headers, account):
    payload = {
        "account_id": account.id,
        "amount": -1,
        "description": "no-key",
        "transaction_date": "2026-03-10",
    }
    a = client.post("/transactions/", json=payload, headers=auth_headers)
    b = client.post("/transactions/", json=payload, headers=auth_headers)
    assert a.status_code == 201 and b.status_code == 201
    # Two distinct rows, no idempotency short-circuit.
    assert a.json()["id"] != b.json()["id"]


def test_expired_key_permits_new_execution(client, db_session, user, auth_headers, account):
    key = str(uuid4())
    headers = {**auth_headers, "Idempotency-Key": key}
    payload = {
        "account_id": account.id,
        "amount": -3,
        "description": "expired",
        "transaction_date": "2026-03-10",
    }
    first = client.post("/transactions/", json=payload, headers=headers)
    assert first.status_code == 201

    # Force expiry.
    row = db_session.query(IdempotencyKey).filter_by(user_id=user.id, key=key).one()
    row.expires_at = utc_now() - timedelta(minutes=1)
    db_session.commit()

    second = client.post("/transactions/", json=payload, headers=headers)
    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]
