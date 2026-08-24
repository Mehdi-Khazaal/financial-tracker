"""Merchant resolution and category suggestion, shared by both write paths.

Manual entry (`LedgerService`) and Plaid sync used to be entirely separate.
Sync wrote rows with a raw bulk insert, so it never registered a merchant
alias and never suggested a category — every bank-imported transaction landed
uncategorized, and the merchant tables stayed effectively empty for anyone who
actually connected a bank. This module is the shared step both paths now call.

It is deliberately session-only: it stages values and never commits. Plaid sync
commits per page to preserve its cursor, and `LedgerService` commits per write;
neither can tolerate an enrichment step taking control of the transaction
boundary.

──────────────────────────────────────────────────────────────────────────────
Category precedence — the exact rules
──────────────────────────────────────────────────────────────────────────────
1. **An explicit category always wins.** If the caller supplied `category_id`,
   nothing here touches it. Source is recorded as "user".
2. **The user's own history for this merchant entity** (Plaid
   `merchant_entity_id`), if it clears the confidence bar below.
3. **The user's own history for this merchant key** (normalized description),
   same bar.
4. **Plaid's personal finance category**, mapped through an explicit table to
   one of the user's *existing* category names.
5. **Otherwise uncategorized.** Leaving `category_id` null is a valid, and
   frequently correct, outcome. A wrong category is worse than none: it
   silently distorts every total the user reads.

The confidence bar for a history vote (2 and 3):
  • at least `MIN_HISTORY_OBSERVATIONS` prior categorized transactions for the
    same identity, and
  • the leading category holds at least `MIN_HISTORY_DOMINANCE` of them.
A tie, or anything short of the bar, yields no suggestion.

Tenant isolation: every history query filters on `user_id`. There is no
cross-user vote. `MerchantCanonical.default_category_id` — which *is* a global
cross-user majority — is deliberately not consulted, because one user's
categorization must never leak into another's ledger.
"""

from __future__ import annotations

import os
from collections import Counter
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.database import Category, Transaction
from services import merchants

# ─── Kill switch ──────────────────────────────────────────────────────────────
# Automatic categorization is new behaviour: before Phase 5A every Plaid import
# landed uncategorized. Set `AUTO_CATEGORIZE=false` to turn just that off
# without reverting the deployment.
#
# **Default is enabled.** Setting the variable to "false" (case-insensitive) is
# the only thing that disables it; anything else, including it being unset,
# leaves it on.
#
# This is the *operator's* switch and it is not the same as the user's. Since
# Phase 6D each user also has `automatic_categorization_enabled`, and effective
# behaviour is `global AND user`: this switch can disable the feature for
# everyone, and nothing a user sets can turn it back on. See
# `services.user_preferences.automatic_categorization_enabled`.
#
# What disabling does *not* touch, at either level: merchant identity still
# resolves, `merchant_key` and every Plaid metadata column are still written,
# and aliases are still registered. Only the act of choosing a category stops.
# New imports simply arrive uncategorized, exactly as they did before this
# phase — and a category the user set is never affected either way.


def auto_categorize_enabled() -> bool:
    """Whether inference may assign a category. Read per call, not cached at
    import, so the switch takes effect on a restart without a code change."""
    return os.getenv("AUTO_CATEGORIZE", "true").strip().lower() != "false"


# ─── Confidence thresholds ────────────────────────────────────────────────────
# Two observations is enough to call a pattern: a single prior transaction is
# as likely to be a one-off miscategorization as a habit.
MIN_HISTORY_OBSERVATIONS = 2
# The leading category must hold 60% of the observations. At exactly 50% the
# user files this merchant two ways and we have no basis to pick one.
MIN_HISTORY_DOMINANCE = 0.6

# Category source markers, stored on `Transaction.category_source`.
SOURCE_USER = "user"
SOURCE_MERCHANT_HISTORY = "merchant_history"
SOURCE_PLAID_PFC = "plaid_pfc"


# ─── Plaid PFC → Fintrack category ────────────────────────────────────────────
# An explicit mapping layer, never a direct substitution. Plaid's taxonomy and
# the user's categories are different vocabularies, and a user may have renamed
# or deleted any of these. Values are matched case-insensitively against the
# names of categories the user *already has*; nothing is auto-created, and a
# miss simply leaves the transaction uncategorized.
#
# Keyed on PFC `primary`. Deliberately incomplete: the entries left out
# (TRANSFER_IN, TRANSFER_OUT, LOAN_PAYMENTS, BANK_FEES,
# GOVERNMENT_AND_NON_PROFIT, GENERAL_SERVICES, HOME_IMPROVEMENT) have no
# unambiguous counterpart among the seeded categories, and guessing at them
# would create exactly the quiet misfiling this layer exists to prevent.
PFC_TO_CATEGORY_NAME: dict[str, str] = {
    "INCOME": "Salary",
    "FOOD_AND_DRINK": "Food & Dining",
    "ENTERTAINMENT": "Entertainment",
    "GENERAL_MERCHANDISE": "Shopping",
    "MEDICAL": "Healthcare",
    "PERSONAL_CARE": "Healthcare",
    "RENT_AND_UTILITIES": "Utilities",
    "TRANSPORTATION": "Transportation",
    "TRAVEL": "Travel",
}


@dataclass(frozen=True)
class MerchantIdentity:
    """Who a transaction was with.

    `entity_id` is authoritative when present. `key` is the normalized-string
    fallback and may be empty when the description carries no usable signal
    (blank, or entirely transaction noise).
    """

    entity_id: Optional[str]
    key: str

    @property
    def is_resolvable(self) -> bool:
        return bool(self.entity_id or self.key)


def resolve_transaction_merchant(
    description: Optional[str],
    *,
    plaid_merchant_entity_id: Optional[str] = None,
) -> MerchantIdentity:
    """Determine merchant identity from what we know about a transaction.

    Pure — no database access — so callers can use it during backfill and in
    tests without a session.
    """
    entity_id = (plaid_merchant_entity_id or "").strip() or None
    return MerchantIdentity(entity_id=entity_id, key=merchants.merchant_key(description))


# How many un-backfilled rows the legacy fallback will normalize in Python.
# Bounded because that tier cannot use an index; it exists only to bridge the
# window between this deploy and the backfill run.
_LEGACY_SCAN_LIMIT = 500


def _decide(category_ids: list[int]) -> Optional[int]:
    """Apply the confidence bar to a set of observed categories."""
    if len(category_ids) < MIN_HISTORY_OBSERVATIONS:
        return None
    counts = Counter(category_ids)
    top_category, top_count = counts.most_common(1)[0]
    # An exact tie between two categories is not a majority.
    if len(counts) > 1 and counts.most_common(2)[1][1] == top_count:
        return None
    if top_count / len(category_ids) >= MIN_HISTORY_DOMINANCE:
        return top_category
    return None


def _legacy_description_vote(
    session: Session,
    user_id: int,
    identity: MerchantIdentity,
) -> Optional[int]:
    """Third-tier fallback for rows written before `merchant_key` existed.

    Those rows have a null key, so the indexed lookup cannot see them. This
    normalizes their descriptions in Python and votes among the matches. It is
    capped and intentionally temporary — once the backfill has run, every row
    has a key and this tier stops finding anything.
    """
    if not identity.key:
        return None
    rows = (
        session.query(Transaction.description, Transaction.category_id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.merchant_key.is_(None),
            Transaction.category_id.isnot(None),
            Transaction.description.isnot(None),
        )
        .order_by(Transaction.transaction_date.desc())
        .limit(_LEGACY_SCAN_LIMIT)
        .all()
    )
    matched = [
        category_id
        for description, category_id in rows
        if merchants.merchant_key(description) == identity.key
    ]
    return _decide(matched)


def _history_vote(
    session: Session,
    user_id: int,
    identity: MerchantIdentity,
) -> Optional[int]:
    """Most-frequent category this *user* filed this merchant under.

    Tiers, in order: Plaid entity ID, stored merchant key, then the legacy
    description scan. A decisive answer at any tier short-circuits the rest.
    Every query is filtered to `user_id` — there is no cross-user vote.
    """
    for column, value in (
        (Transaction.plaid_merchant_entity_id, identity.entity_id),
        (Transaction.merchant_key, identity.key or None),
    ):
        if not value:
            continue
        rows = (
            session.query(Transaction.category_id)
            .filter(
                Transaction.user_id == user_id,
                column == value,
                Transaction.category_id.isnot(None),
            )
            .all()
        )
        decided = _decide([row[0] for row in rows])
        if decided is not None:
            return decided

    return _legacy_description_vote(session, user_id, identity)


def _pfc_category(
    session: Session,
    user_id: int,
    pfc_primary: Optional[str],
) -> Optional[int]:
    """Map Plaid's PFC to one of the user's existing categories, or None."""
    if not pfc_primary:
        return None
    target_name = PFC_TO_CATEGORY_NAME.get(pfc_primary.strip().upper())
    if not target_name:
        return None
    category = (
        session.query(Category)
        .filter(
            Category.user_id == user_id,
            func.lower(Category.name) == target_name.lower(),
        )
        .first()
    )
    return category.id if category else None


def suggest_transaction_category(
    session: Session,
    user_id: int,
    identity: MerchantIdentity,
    *,
    pfc_primary: Optional[str] = None,
) -> tuple[Optional[int], Optional[str]]:
    """Suggest a category for an *uncategorized* transaction.

    Returns `(category_id, source)`, or `(None, None)` when there is not
    enough signal. Callers must not use this to override a category the user
    already chose.

    This is the only place in the application that decides a category
    automatically — Plaid's `added` rows, its `modified` rows, and manual
    entries saved without one all arrive here — which is why the preference is
    enforced at this single point rather than at each call site. A gate per
    caller would be three chances to miss one.

    Imported locally to keep the module import graph acyclic:
    `services.user_preferences` reads the global switch from here.
    """
    from services import user_preferences

    if not user_preferences.automatic_categorization_enabled(session, user_id):
        return None, None

    if identity.is_resolvable:
        voted = _history_vote(session, user_id, identity)
        if voted is not None:
            return voted, SOURCE_MERCHANT_HISTORY

    mapped = _pfc_category(session, user_id, pfc_primary)
    if mapped is not None:
        return mapped, SOURCE_PLAID_PFC

    return None, None


def enrich_transaction_input(
    session: Session,
    user_id: int,
    values: Mapping[str, Any],
    *,
    register_alias: bool = True,
) -> dict:
    """Return `values` with merchant identity and category fields filled in.

    Never mutates the input. Never commits. Safe to call on both ingestion
    paths; enrichment failure is swallowed because a normalization problem
    must not block a ledger write.
    """
    enriched = dict(values)
    description = enriched.get("description")

    identity = resolve_transaction_merchant(
        description,
        plaid_merchant_entity_id=enriched.get("plaid_merchant_entity_id"),
    )
    enriched["merchant_key"] = identity.key or None
    if identity.entity_id:
        enriched["plaid_merchant_entity_id"] = identity.entity_id

    # An explicitly supplied category is the user's decision and is recorded
    # as such — no suggestion runs at all.
    if enriched.get("category_id") is not None:
        enriched.setdefault("category_source", SOURCE_USER)
        if register_alias and description:
            _register_alias(session, description)
        return enriched

    # `category_source` must be present whatever happens below, including the
    # common "no suggestion" outcome and the except path. Plaid sync collects
    # these dicts into a single multi-row INSERT, and SQLAlchemy renders that
    # statement from the *first* row's keys; a later row missing the key has no
    # Python-side default to fall back on, so the statement fails to compile and
    # takes the entire page of transactions with it — a silent, total sync
    # failure that only appears when one page holds both a categorized and an
    # uncategorized row.
    enriched.setdefault("category_source", None)

    try:
        if register_alias and description:
            _register_alias(session, description)
        category_id, source = suggest_transaction_category(
            session,
            user_id,
            identity,
            pfc_primary=enriched.get("personal_finance_category_primary"),
        )
        if category_id is not None:
            enriched["category_id"] = category_id
            enriched["category_source"] = source
    except Exception:
        # Enrichment is best-effort. A failure here leaves the transaction
        # uncategorized, which is a valid state, rather than failing the write.
        pass

    return enriched


def _register_alias(session: Session, description: str) -> None:
    """Record the raw string against its canonical merchant.

    Kept separate so the failure is contained: an alias-write problem must not
    prevent a category suggestion that has already been computed.
    """
    try:
        merchants.resolve_or_create(session, description)
    except Exception:
        pass
