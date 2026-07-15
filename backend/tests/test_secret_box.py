from utils.secret_box import decrypt_secret, encrypt_secret, is_encrypted


def test_secret_box_encrypts_and_round_trips(monkeypatch):
    monkeypatch.setenv("PLAID_TOKEN_ENCRYPTION_KEY", "test-only-plaid-key")
    plaintext = "access-sandbox-sensitive-value"

    encrypted = encrypt_secret(plaintext)

    assert is_encrypted(encrypted)
    assert plaintext not in encrypted
    assert decrypt_secret(encrypted) == plaintext


def test_secret_box_reads_legacy_plaintext_for_lazy_migration():
    assert decrypt_secret("legacy-token") == "legacy-token"
