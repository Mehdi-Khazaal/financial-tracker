"""No database work on the event loop.

FastAPI runs a sync route or dependency in its threadpool and an `async def`
one on the event loop. `get_current_user` was `async def` and queried the
database, so on production a burst of thirteen requests (the Dashboard alone
sends ten) waited on the ten-connection pool *on the loop*: nothing else could
run, not even the teardowns that would have returned connections, and the
burst sat for two pool timeouts (22 s) before two requests failed with 500.

These tests fail if a query runs on the loop thread again, wherever it comes
from: a dependency, a route, or the idempotency middleware.
"""

import asyncio
import inspect
import json
from uuid import uuid4

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import event

from models import database
from models.database import get_db
from routers import plaid_router as facade
from routers.plaid_router import webhook as plaid_webhook


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


@pytest.fixture
def loop_queries(db_session):
    """Statements executed on an event loop thread, from any engine the app uses."""
    seen: list[str] = []

    def record(_conn, _cursor, statement, _params, _context, _many):
        if _on_event_loop():
            seen.append(statement.split("\n")[0][:120])

    engines = {db_session.get_bind(), database.engine}
    for engine in engines:
        event.listen(engine, "before_cursor_execute", record)
    yield seen
    for engine in engines:
        event.remove(engine, "before_cursor_execute", record)


def test_authenticated_reads_query_off_the_loop(client, auth_headers, account, loop_queries):
    for path in ("/auth/me", "/accounts/", "/preferences", "/paycheck-plan", "/savings-goals/"):
        assert client.get(path, headers=auth_headers).status_code == 200, path

    assert loop_queries == []


def test_idempotent_writes_query_off_the_loop(client, auth_headers, account, loop_queries):
    headers = {**auth_headers, "Idempotency-Key": str(uuid4())}
    payload = {"account_id": account.id, "amount": -4.5, "description": "Coffee", "transaction_date": "2026-11-10"}

    first = client.post("/transactions/", json=payload, headers=headers)
    replay = client.post("/transactions/", json=payload, headers=headers)

    assert first.status_code == replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    assert loop_queries == []


def test_plaid_webhook_stamps_off_the_loop(client, db_session, user, loop_queries, monkeypatch):
    from routers.plaid_router.models import PlaidItem

    item = PlaidItem(user_id=user.id, item_id="item-loop", access_token="token", institution_name="Bank")
    db_session.add(item)
    db_session.commit()
    monkeypatch.setattr(facade, "_verify_plaid_webhook", lambda _body, _token: True)
    synced: list[tuple] = []
    monkeypatch.setattr(facade, "_do_sync_and_notify", lambda *args: synced.append(args))

    body = {"webhook_type": "TRANSACTIONS", "webhook_code": "SYNC_UPDATES_AVAILABLE", "item_id": "item-loop"}
    response = client.post("/plaid/webhook", content=json.dumps(body), headers={"Plaid-Verification": "x"})

    assert response.status_code == 200
    assert synced and synced[0][0] == item.id
    assert loop_queries == []
    assert plaid_webhook._stamp_webhook("unknown-item", "DEFAULT_UPDATE") is None


def _async_users_of_the_database(route: APIRoute) -> list[str]:
    found = []

    def walk(dependant, owner: str):
        call = dependant.call
        name = getattr(call, "__name__", repr(call))
        if call is not None and inspect.iscoroutinefunction(call):
            if any(sub.call is get_db for sub in dependant.dependencies):
                found.append(f"{route.path}: {name}")
        for sub in dependant.dependencies:
            walk(sub, name)

    walk(route.dependant, route.path)
    return found


def test_no_async_route_or_dependency_takes_a_database_session(client):
    offenders = [
        hit
        for route in client.app.routes
        if isinstance(route, APIRoute)
        for hit in _async_users_of_the_database(route)
    ]
    assert offenders == []
