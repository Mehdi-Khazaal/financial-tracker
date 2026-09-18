"""Pending assistant actions live in the database, not in the process.

The property under test: a confirmation minted by one process, before a
restart or on another worker, still executes once — and only once.
"""

from datetime import timedelta

import pytest
from fastapi import HTTPException

from models.database import Account, AssistantPendingAction, utc_now
from routers import assistant
from routers.assistant.pending import _consume_pending_action, prune_expired_pending_actions


def test_token_is_stored_hashed_and_survives_a_fresh_session(db_session, user):
    from sqlalchemy.orm import Session

    token = assistant._register_pending_action(db_session, user.id, None, "add_account", {"name": "x", "type": "cash"})

    row = db_session.query(AssistantPendingAction).one()
    assert row.token_hash != token and len(row.token_hash) == 64
    assert row.consumed_at is None

    # A different session stands in for "a different process".
    other = Session(bind=db_session.get_bind())
    try:
        action = _consume_pending_action(other, token, user.id, None)
    finally:
        other.close()
    assert action["tool"] == "add_account"
    assert action["input"] == {"name": "x", "type": "cash"}


def test_a_consumed_token_cannot_be_used_twice(db_session, user):
    token = assistant._register_pending_action(db_session, user.id, None, "add_account", {"name": "x", "type": "cash"})
    _consume_pending_action(db_session, token, user.id, None)

    with pytest.raises(HTTPException) as excinfo:
        _consume_pending_action(db_session, token, user.id, None)
    assert excinfo.value.status_code == 400


def test_an_expired_token_is_refused(db_session, user):
    token = assistant._register_pending_action(db_session, user.id, None, "add_account", {"name": "x", "type": "cash"})
    row = db_session.query(AssistantPendingAction).one()
    row.expires_at = utc_now() - timedelta(seconds=1)
    db_session.commit()

    with pytest.raises(HTTPException) as excinfo:
        _consume_pending_action(db_session, token, user.id, None)
    assert excinfo.value.status_code == 400


def test_another_users_token_is_not_found(db_session, user):
    token = assistant._register_pending_action(db_session, user.id, None, "add_account", {"name": "x", "type": "cash"})

    with pytest.raises(HTTPException) as excinfo:
        _consume_pending_action(db_session, token, user.id + 1, None)
    assert excinfo.value.status_code == 404
    # Still unconsumed for the rightful owner.
    assert _consume_pending_action(db_session, token, user.id, None)["tool"] == "add_account"


def test_execute_through_the_api_is_exactly_once(client, db_session, user, auth_headers):
    payload = {"name": "Persisted", "type": "checking", "balance": 5}
    token = assistant._register_pending_action(db_session, user.id, None, "add_account", payload)
    body = {"tool": "add_account", "input": payload, "action_token": token}

    first = client.post("/assistant/execute", headers=auth_headers, json=body)
    second = client.post("/assistant/execute", headers=auth_headers, json=body)

    assert first.status_code == 200
    assert second.status_code == 400
    assert db_session.query(Account).filter(Account.name == "Persisted").count() == 1


def test_prune_removes_expired_and_consumed_rows_only(db_session, user):
    live = assistant._register_pending_action(db_session, user.id, None, "add_account", {"name": "a", "type": "cash"})
    used = assistant._register_pending_action(db_session, user.id, None, "add_account", {"name": "b", "type": "cash"})
    stale = assistant._register_pending_action(db_session, user.id, None, "add_account", {"name": "c", "type": "cash"})
    _consume_pending_action(db_session, used, user.id, None)
    from routers.assistant.pending import _token_hash
    db_session.query(AssistantPendingAction).filter_by(token_hash=_token_hash(stale)).update(
        {"expires_at": utc_now() - timedelta(minutes=1)}
    )
    db_session.commit()

    assert prune_expired_pending_actions(db_session) == 2
    remaining = db_session.query(AssistantPendingAction).all()
    assert [r.token_hash for r in remaining] == [_token_hash(live)]
