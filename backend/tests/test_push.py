"""Push subscriptions: only public HTTPS endpoints are ever stored."""

import pytest

from models.push import PushSubscription
from routers.push import validate_push_endpoint

GOOD = "https://fcm.googleapis.com/fcm/send/abc123"
KEYS = {"p256dh": "BPublicKey", "auth": "AuthSecret"}


def test_subscribe_stores_a_public_https_endpoint(client, db_session, user, auth_headers):
    response = client.post("/push/subscribe", headers=auth_headers, json={"endpoint": GOOD, "keys": KEYS})

    assert response.status_code == 204
    row = db_session.query(PushSubscription).one()
    assert row.user_id == user.id
    assert row.endpoint == GOOD
    assert row.p256dh == "BPublicKey"


def test_subscribe_is_idempotent_and_moves_the_endpoint_to_the_latest_user(client, db_session, user, auth_headers):
    client.post("/push/subscribe", headers=auth_headers, json={"endpoint": GOOD, "keys": KEYS})
    client.post("/push/subscribe", headers=auth_headers, json={"endpoint": GOOD, "keys": {**KEYS, "auth": "New"}})

    rows = db_session.query(PushSubscription).all()
    assert len(rows) == 1
    assert rows[0].auth == "New"


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",           # plain http
        "https://user:pw@fcm.googleapis.com/send/abc",      # credentials
        "https://127.0.0.1/hook",                            # loopback literal
        "https://10.0.0.5/hook",                             # private literal
        "https://[::1]/hook",                                # v6 loopback
        "https://169.254.169.254/latest/meta-data",          # cloud metadata
        "https://localhost/hook",
        "https://render.local/hook",
        "https://intranet/hook",                             # no dot
        "ftp://push.example.com/x",
        "",
        "not a url",
    ],
)
def test_subscribe_rejects_unsafe_endpoints(client, db_session, auth_headers, endpoint):
    response = client.post("/push/subscribe", headers=auth_headers, json={"endpoint": endpoint, "keys": KEYS})

    assert response.status_code == 422, endpoint
    assert db_session.query(PushSubscription).count() == 0


def test_subscribe_requires_both_keys(client, db_session, auth_headers):
    for keys in ({}, {"p256dh": "x"}, {"auth": "y"}, {"p256dh": "", "auth": "y"}):
        response = client.post("/push/subscribe", headers=auth_headers, json={"endpoint": GOOD, "keys": keys})
        assert response.status_code == 422, keys
    assert db_session.query(PushSubscription).count() == 0


def test_validator_accepts_real_push_services():
    for endpoint in (
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/QAbc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ):
        assert validate_push_endpoint(endpoint) == endpoint


def test_unsubscribe_removes_only_the_callers_row(client, db_session, user, auth_headers):
    client.post("/push/subscribe", headers=auth_headers, json={"endpoint": GOOD, "keys": KEYS})

    response = client.post("/push/unsubscribe", headers=auth_headers, json={"endpoint": GOOD})

    assert response.status_code == 204
    assert db_session.query(PushSubscription).count() == 0
