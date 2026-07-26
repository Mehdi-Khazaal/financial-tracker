"""Merchant string normalization + category auto-fill.

Plaid returns messy merchant strings. This module:
  1. Normalizes a raw string → canonical key (lowercased, punctuation and
     transaction noise stripped).
  2. Maintains `MerchantAlias` and `MerchantCanonical` tables so repeat
     transactions from the same merchant share one canonical row.
  3. Suggests a category based on what the user has previously filed this
     merchant under (majority vote), enabling one-tap category on the
     transaction form and auto-categorization for Plaid imports.

Kept deliberately dependency-free — no fuzzy matching library. If two raw
strings collapse to the same normalized key they share a canonical row;
otherwise they don't. Good enough for 95% of real-world variance.
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


_NOISE_TOKENS = re.compile(
    r"\b(purchase|pos|debit|credit|payment|pmt|autopay|recurring|online|"
    r"web|mobile|card|visa|mc|mastercard|amex|check|chk|ach|xfer|transfer|"
    r"deposit|withdrawal|fee|inc|llc|ltd|corp|co)\b",
    re.IGNORECASE,
)
# Strips 3+ digit runs (transaction IDs, store numbers, dates) but keeps
# short numerics like "7-11" or "24hr".
_LONG_DIGITS = re.compile(r"\d{3,}")
_PUNCT = re.compile(r"[^a-z0-9\s]")
_WHITESPACE = re.compile(r"\s+")


def normalize(raw: str) -> str:
    """Reduce a raw merchant string to a canonical key.

    Idempotent: normalize(normalize(x)) == normalize(x).
    """
    if not raw:
        return ""
    s = raw.lower()
    s = _LONG_DIGITS.sub(" ", s)
    s = _PUNCT.sub(" ", s)
    s = _NOISE_TOKENS.sub(" ", s)
    s = _WHITESPACE.sub(" ", s).strip()
    return s


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


def suggest_category_id(
    session: Session,
    user_id: int,
    raw: str,
) -> Optional[int]:
    """Return the most-frequent category this user has filed this merchant
    under, or the canonical row's `default_category_id` as a fallback.

    Returns None when there is no signal.
    """
    canonical = resolve_or_create(session, raw)
    if canonical is None:
        return None

    # Vote across this user's own history first.
    rows = (
        session.query(Transaction.category_id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.description == raw,
            Transaction.category_id.isnot(None),
        )
        .all()
    )
    if rows:
        counts = Counter(r[0] for r in rows)
        return counts.most_common(1)[0][0]

    return canonical.default_category_id


def refresh_canonical_defaults(session: Session) -> int:
    """Recompute `default_category_id` on each canonical merchant using the
    global majority category across all user transactions whose description
    normalizes to that merchant. Returns rows updated.
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
