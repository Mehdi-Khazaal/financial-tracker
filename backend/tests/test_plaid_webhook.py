import hashlib
import time

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from routers import plaid_router


def _signed_webhook(body: bytes, issued_at: int):
    private_key = ec.generate_private_key(ec.SECP256R1())
    key_id = "test-webhook-key"
    jwk = jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk.update({"kid": key_id, "alg": "ES256", "use": "sig", "expired_at": None})
    token = jwt.encode(
        {
            "iat": issued_at,
            "request_body_sha256": hashlib.sha256(body).hexdigest(),
        },
        private_key,
        algorithm="ES256",
        headers={"kid": key_id},
    )
    return token, jwk


def test_plaid_webhook_verification_accepts_valid_signature(monkeypatch):
    body = b'{"webhook_type":"TRANSACTIONS"}'
    token, jwk = _signed_webhook(body, int(time.time()))
    monkeypatch.setattr(plaid_router, "PLAID_CLIENT_ID", "client-id")
    monkeypatch.setattr(plaid_router, "PLAID_SECRET", "secret")
    monkeypatch.setattr(plaid_router, "_get_plaid_verification_key", lambda _key_id: jwk)

    assert plaid_router._verify_plaid_webhook(body, token) is True


def test_plaid_webhook_verification_rejects_tampered_body(monkeypatch):
    body = b'{"webhook_type":"TRANSACTIONS"}'
    token, jwk = _signed_webhook(body, int(time.time()))
    monkeypatch.setattr(plaid_router, "PLAID_CLIENT_ID", "client-id")
    monkeypatch.setattr(plaid_router, "PLAID_SECRET", "secret")
    monkeypatch.setattr(plaid_router, "_get_plaid_verification_key", lambda _key_id: jwk)

    assert plaid_router._verify_plaid_webhook(body + b" ", token) is False


def test_plaid_webhook_verification_rejects_replay(monkeypatch):
    body = b'{"webhook_type":"TRANSACTIONS"}'
    token, jwk = _signed_webhook(body, int(time.time()) - plaid_router.WEBHOOK_MAX_AGE_SECONDS - 1)
    monkeypatch.setattr(plaid_router, "PLAID_CLIENT_ID", "client-id")
    monkeypatch.setattr(plaid_router, "PLAID_SECRET", "secret")
    monkeypatch.setattr(plaid_router, "_get_plaid_verification_key", lambda _key_id: jwk)

    assert plaid_router._verify_plaid_webhook(body, token) is False