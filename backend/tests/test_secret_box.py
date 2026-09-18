"""The secret box's edges: what it refuses, what it passes through, and a tampered token."""

import pytest

from utils import secret_box
from utils.secret_box import decrypt_secret, encrypt_secret, is_encrypted


# ─── Kept from the original file ─────────────────────────────────────────────
def test_secret_box_encrypts_and_round_trips(monkeypatch):
    monkeypatch.setenv("PLAID_TOKEN_ENCRYPTION_KEY", "test-only-plaid-key")
    plaintext = "access-sandbox-sensitive-value"

    encrypted = encrypt_secret(plaintext)

    assert is_encrypted(encrypted)
    assert plaintext not in encrypted
    assert decrypt_secret(encrypted) == plaintext


def test_secret_box_reads_legacy_plaintext_for_lazy_migration():
    assert decrypt_secret("legacy-token") == "legacy-token"


# ─── Edges added in Phase 6 ───────────────────────────────────────────────────


def test_round_trip_and_idempotent_encrypt():
    token = secret_box.encrypt_secret("access-sandbox-123")
    assert token.startswith("enc:v1:") and secret_box.is_encrypted(token)
    assert secret_box.encrypt_secret(token) == token  # never double-wrapped
    assert secret_box.decrypt_secret(token) == "access-sandbox-123"


def test_plaintext_from_before_encryption_still_reads():
    assert secret_box.decrypt_secret("legacy-plaintext-token") == "legacy-plaintext-token"
    assert not secret_box.is_encrypted("legacy-plaintext-token")


def test_refuses_an_empty_secret():
    with pytest.raises(ValueError):
        secret_box.encrypt_secret("")


def test_a_tampered_token_fails_loudly():
    token = secret_box.encrypt_secret("x")
    broken = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    with pytest.raises(RuntimeError):
        secret_box.decrypt_secret(broken)


def test_no_key_configured_is_an_error_not_a_silent_default(monkeypatch):
    monkeypatch.delenv("PLAID_TOKEN_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError):
        secret_box.encrypt_secret("x")
