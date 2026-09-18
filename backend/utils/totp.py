"""Time-based one-time passwords (RFC 6238 over RFC 4226), standard library only.

Six digits, 30-second steps, HMAC-SHA1 — the defaults every authenticator
app assumes when it scans an `otpauth://` URI. Verification accepts the
current step and one either side, to forgive a phone clock that is a little
off, and returns the step that matched so the caller can refuse to accept the
same step twice (a code seen over someone's shoulder is dead once used).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from typing import Optional
from urllib.parse import quote, urlencode

DIGITS = 6
STEP_SECONDS = 30
WINDOW = 1
ISSUER = "Fintrack"

_CODE = re.compile(r"^\d{6}$")


def new_secret() -> str:
    """160 random bits, base32 without padding (what authenticator apps expect)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _key(secret: str) -> bytes:
    cleaned = secret.replace(" ", "").upper()
    return base64.b32decode(cleaned + "=" * (-len(cleaned) % 8))


def _now() -> float:
    """The clock, as a seam tests can hold still."""
    return time.time()


def step_at(timestamp: Optional[float] = None) -> int:
    return int((_now() if timestamp is None else timestamp) // STEP_SECONDS)


def code_for_step(secret: str, step: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** DIGITS)).zfill(DIGITS)


def normalize(code: str) -> str:
    return re.sub(r"[\s-]", "", code or "")


def verify(secret: str, code: str, *, timestamp: Optional[float] = None, last_step: Optional[int] = None) -> Optional[int]:
    """The matching step, or None. A step at or before `last_step` never matches."""
    candidate = normalize(code)
    if not _CODE.match(candidate):
        return None
    now = step_at(timestamp)
    for step in range(now - WINDOW, now + WINDOW + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(code_for_step(secret, step), candidate):
            return step
    return None


def provisioning_uri(secret: str, account: str) -> str:
    label = quote(f"{ISSUER}:{account}", safe="")
    query = urlencode({"secret": secret, "issuer": ISSUER, "digits": DIGITS, "period": STEP_SECONDS})
    return f"otpauth://totp/{label}?{query}"


def grouped(secret: str) -> str:
    """The secret in fours, for typing into an app by hand."""
    return " ".join(secret[i:i + 4] for i in range(0, len(secret), 4))
