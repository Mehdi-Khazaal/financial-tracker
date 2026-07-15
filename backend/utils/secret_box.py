import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken


_PREFIX = "enc:v1:"


def _cipher() -> Fernet:
    source = os.getenv("PLAID_TOKEN_ENCRYPTION_KEY") or os.getenv("SECRET_KEY")
    if not source:
        raise RuntimeError("PLAID_TOKEN_ENCRYPTION_KEY or SECRET_KEY is required")
    key = base64.urlsafe_b64encode(hashlib.sha256(source.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    if not value:
        raise ValueError("Cannot encrypt an empty secret")
    if value.startswith(_PREFIX):
        return value
    encrypted = _cipher().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{_PREFIX}{encrypted}"


def decrypt_secret(value: str) -> str:
    if not value.startswith(_PREFIX):
        return value
    try:
        return _cipher().decrypt(value[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored secret could not be decrypted") from exc


def is_encrypted(value: str) -> bool:
    return value.startswith(_PREFIX)
