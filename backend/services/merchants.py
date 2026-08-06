"""Merchant identity — the single authoritative implementation.

This module answers one question: *which merchant is this?* Every write path
resolves it here, so the frontend never has to guess. Identity has two levels,
in strict precedence order:

  1. **Plaid `merchant_entity_id`** — a stable identifier Plaid maintains
     across every string variant a bank might emit. When present it *is* the
     answer, and no string processing happens at all.
  2. **`merchant_key`** — the normalized description, used for manual entries
     and for Plaid rows Plaid did not enrich.

`normalize` is the fallback, and it is deliberately conservative. It cleans up
mechanical noise banks add — processor prefixes, phone numbers, reference
numbers, domains — but it never fuzzy-matches. Two strings merge only when
they clean to exactly the same key. That means it under-merges rather than
over-merges, which is the right failure direction: showing one subscription
twice is a cosmetic bug, while merging two unrelated businesses silently
corrupts the user's category history.

Explicitly **not** an attempt to build a universal merchant database by regex.
Where Plaid gives us an entity ID we use it; the regex exists only to cover
what Plaid does not.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.database import (
    MerchantAlias,
    MerchantCanonical,
    Transaction,
)


# ─── Normalization pipeline ───────────────────────────────────────────────────
# Order is load-bearing. Domains and dates must be handled while their
# punctuation is still intact, because once `_PUNCT` runs "netflix.com" is
# indistinguishable from the two words "netflix com".

# Payment processors prepend a short code and an asterisk: "SQ *COFFEE BAR",
# "TST* DINER", "PAYPAL *STORE". The list is bounded on purpose. A general
# rule like "any short token before an asterisk" would also strip the merchant
# out of "NETFLIX*MEMBERSHIP", turning it into "membership".
_PROCESSOR_PREFIX = re.compile(
    r"^\s*(?:sq|tst|pp|paypal|py|sp|wl|in|ec|dd|par|clv|msp|ib|gpay|googlepay"
    r"|toast|stripe|shopify|venmo|zelle|square)\s*\*+\s*",
    re.IGNORECASE,
)

# Leading boilerplate banks add to card transactions. Anchored so it can only
# strip a *prefix* — "purchase" mid-string is handled by `_NOISE_TOKENS`.
_BANK_PREFIX = re.compile(
    r"^\s*(?:"
    r"purchase\s+authorized\s+on|recurring\s+payment(?:\s+authorized\s+on)?|"
    r"debit\s+card\s+purchase|credit\s+card\s+purchase|checkcard|checkcrd|"
    r"pos\s+debit|pos\s+purchase|point\s+of\s+sale|external\s+withdrawal|"
    r"preauthorized\s+(?:debit|credit)|ach\s+(?:debit|credit|web|pmt)|"
    r"card\s+purchase|misc\s+debit|electronic\s+(?:withdrawal|deposit)"
    r")\b\s*",
    re.IGNORECASE,
)

_WWW = re.compile(r"\bwww\.", re.IGNORECASE)
# Trailing TLD on a token: "netflix.com", "spotify.co.uk", "apple.com/bill".
_TLD = re.compile(
    r"\.(?:com?|net|org|io|gov|edu|biz|info|tv|me|app|shop|store|xyz|us|uk|ca|au|de|fr|nl|es|it)"
    r"(?:\.[a-z]{2})?\b",
    re.IGNORECASE,
)

# North-American phone numbers in the shapes banks actually emit, including
# the bare 10/11-digit run. Must run before `_LONG_DIGITS` so the grouping
# separators are still present to match on.
_PHONE = re.compile(
    r"(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]\d{3}[\s.\-]\d{4}\b"
    r"|\b(?:\+?1)?\d{10}\b"
)

# Dates like "03/15" or "03/15/26" that bank prefixes leave behind. Handled
# explicitly so `_LONG_DIGITS` does not have to strip 2-digit runs, which
# would also destroy names like "7-11".
#
# Slash-separated matches with or without a year, because "03/15" is
# unambiguously a date in this context. Hyphen-separated requires the year:
# "7-11" is a shop, "03-15-26" is a date.
_DATE_LIKE = re.compile(
    r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b"
    r"|\b\d{1,2}-\d{1,2}-\d{2,4}\b"
)

# Reference numbers, store numbers, transaction IDs. Kept at 3+ digits so
# short numerics that are part of a name ("7-11", "24hr") survive.
_LONG_DIGITS = re.compile(r"\d{3,}")

_PUNCT = re.compile(r"[^a-z0-9\s]")

# Words that carry no merchant identity. `membership`/`subscription`/`renewal`
# are descriptors of the *charge*, not the business, so "NETFLIX*MEMBERSHIP"
# and "NETFLIX" are the same merchant. Words that *do* distinguish businesses
# — "store", "bakery", "market" — are deliberately absent: stripping those
# would merge "Apple Store" into "Apple".
_NOISE_TOKENS = re.compile(
    r"\b(purchase|pos|debit|credit|payment|pmt|autopay|recurring|online|"
    r"web|mobile|card|visa|mc|mastercard|amex|check|chk|ach|xfer|transfer|"
    r"deposit|withdrawal|fee|inc|llc|ltd|corp|co|com|www|"
    r"membership|subscription|renewal|autorenew|billing|bill|"
    r"monthly|annual|yearly|recur)\b",
    re.IGNORECASE,
)

_WHITESPACE = re.compile(r"\s+")


def _is_reference_token(token: str) -> bool:
    """True for an alphanumeric reference code like "a12bc" or "p1a2b3c".

    Banks append these as order or authorization codes. Pure digit runs are
    already gone by this point; what is left is the mixed letter-and-digit
    kind, which `_LONG_DIGITS` cannot match.

    The three conditions together are what keep real names safe: "24hr" has
    only two digits but is four characters, and "7eleven" has just one digit,
    so neither qualifies.
    """
    if len(token) < 5:
        return False
    digits = sum(character.isdigit() for character in token)
    return digits >= 2 and digits < len(token)

# Legacy prefix from an older Plaid import path. No current code writes it,
# but historical rows still carry it and must normalize to the same key.
_LEGACY_PLAID_PREFIX = re.compile(r"^\s*\[plaid:[^\]]*\]\s*", re.IGNORECASE)


def normalize(raw: str) -> str:
    """Reduce a raw merchant string to a canonical key.

    Idempotent: `normalize(normalize(x)) == normalize(x)`, which
    `test_merchants.py` asserts — the backfill relies on being able to re-run
    over already-normalized values without drift.
    """
    if not raw:
        return ""
    s = raw.lower()
    s = _LEGACY_PLAID_PREFIX.sub(" ", s)
    s = _BANK_PREFIX.sub(" ", s)
    # Processors can stack behind a bank prefix ("POS DEBIT SQ *CAFE"), so run
    # the processor strip after the bank strip, and allow a second pass.
    s = _PROCESSOR_PREFIX.sub(" ", s)
    s = _PROCESSOR_PREFIX.sub(" ", s)
    s = _WWW.sub(" ", s)
    s = _TLD.sub(" ", s)
    s = _PHONE.sub(" ", s)
    s = _DATE_LIKE.sub(" ", s)
    s = _LONG_DIGITS.sub(" ", s)
    s = _PUNCT.sub(" ", s)
    s = _NOISE_TOKENS.sub(" ", s)
    s = " ".join(t for t in s.split() if not _is_reference_token(t))
    s = _WHITESPACE.sub(" ", s).strip()
    return s


def merchant_key(raw: Optional[str]) -> str:
    """Public name for the fallback identity. Empty string when unresolvable."""
    return normalize(raw or "")


def display_name(raw: str) -> str:
    """Human-facing canonical name derived from a raw string."""
    key = normalize(raw)
    if not key:
        return raw.strip()[:120]
    return " ".join(w.capitalize() for w in key.split())[:120]


def resolve_or_create(session: Session, raw: str) -> Optional[MerchantCanonical]:
    """Look up (or create) the canonical merchant for a raw string.

    Returns None only when the raw string is empty/whitespace.
    """
    if not raw or not raw.strip():
        return None

    alias = session.query(MerchantAlias).filter(MerchantAlias.raw_name == raw).one_or_none()
    if alias:
        return alias.canonical

    key = normalize(raw)
    if not key:
        return None

    canonical = (
        session.query(MerchantCanonical)
        .filter(func.lower(MerchantCanonical.name) == key)
        .one_or_none()
    )
    if not canonical:
        canonical = MerchantCanonical(name=display_name(raw))
        session.add(canonical)
        session.flush()

    session.add(MerchantAlias(raw_name=raw, canonical_id=canonical.id))
    session.flush()
    return canonical


def refresh_canonical_defaults(session: Session) -> int:
    """Recompute `default_category_id` on each canonical merchant using the
    global majority category across all user transactions whose description
    normalizes to that merchant. Returns rows updated.

    **Not a category-suggestion source.** This aggregate spans every user, so
    consulting it when categorizing would let one user's filing decisions
    change what another user sees. `services.transaction_enrichment` votes
    strictly within the current user's own history instead. This value is
    retained only as descriptive metadata about a merchant, and the nightly
    cron that recomputes it is kept so the external scheduler's call does not
    start 404ing.
    """
    updated = 0
    for canonical in session.query(MerchantCanonical).all():
        aliases = (
            session.query(MerchantAlias.raw_name)
            .filter(MerchantAlias.canonical_id == canonical.id)
            .all()
        )
        raw_names = [a[0] for a in aliases]
        if not raw_names:
            continue
        rows = (
            session.query(Transaction.category_id)
            .filter(
                Transaction.description.in_(raw_names),
                Transaction.category_id.isnot(None),
            )
            .all()
        )
        if not rows:
            continue
        top = Counter(r[0] for r in rows).most_common(1)[0][0]
        if canonical.default_category_id != top:
            canonical.default_category_id = top
            updated += 1
    session.commit()
    return updated
