"""Categorization rules — the user's explicit "file this as that" instructions.

Where this sits in the category precedence (see `transaction_enrichment`):

    explicit category on the write  >  **rule**  >  merchant history  >  Plaid PFC

A rule is an instruction, not an inference, so it runs even when the user has
switched automatic categorization off — that switch governs Fintrack's
*guesses*. What a rule never does is overwrite a category the user set on a
specific transaction: `category_source == "user"` is untouchable, both at
write time (the explicit category short-circuits before rules are consulted)
and when a rule is applied to the past.

Matching is deliberately simple and total:

* `field="description"` looks at the transaction's description; `"merchant"`
  looks at the normalised merchant key (`services.merchants.merchant_key`), so
  "NETFLIX.COM 866-579-7172" and "Netflix" hit the same rule.
* `match_type="contains"` is a case-insensitive substring test; `"regex"` is a
  Python regular expression, case-insensitive, searched anywhere in the field.
  Patterns are capped at 200 characters and compiled once per session.

Everything here stages and never commits — the same contract as enrichment,
because Plaid sync commits per page and the ledger commits per write.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models.database import CategorizationRule, Category, Transaction
from services import merchants

FIELDS = ("description", "merchant")
MATCH_TYPES = ("contains", "regex")
MAX_PATTERN_LENGTH = 200

# Sources a retroactive apply may replace. "user" is absent on purpose.
REPLACEABLE_SOURCES = ("rule", "merchant_history", "plaid_pfc")

_CACHE_KEY = "fintrack_categorization_rules"


class InvalidRule(ValueError):
    """The rule cannot be evaluated: bad field, match type or regex."""


@dataclass(frozen=True)
class CompiledRule:
    id: Optional[int]
    category_id: int
    field: str
    match_type: str
    pattern: str
    priority: int
    _regex: Optional[re.Pattern]
    _needle: str

    def matches(self, description: Optional[str], merchant_key: Optional[str]) -> bool:
        haystack = (description if self.field == "description" else merchant_key) or ""
        if not haystack:
            return False
        if self._regex is not None:
            return self._regex.search(haystack) is not None
        return self._needle in haystack.lower()


def validate(field: str, match_type: str, pattern: str) -> None:
    """Raise `InvalidRule` with a user-facing reason when the rule cannot run."""
    if field not in FIELDS:
        raise InvalidRule("field must be 'description' or 'merchant'")
    if match_type not in MATCH_TYPES:
        raise InvalidRule("match_type must be 'contains' or 'regex'")
    text = (pattern or "").strip()
    if not text:
        raise InvalidRule("pattern must not be empty")
    if len(text) > MAX_PATTERN_LENGTH:
        raise InvalidRule(f"pattern must be at most {MAX_PATTERN_LENGTH} characters")
    if match_type == "regex":
        try:
            re.compile(text, re.IGNORECASE)
        except re.error as exc:
            raise InvalidRule(f"pattern is not a valid regular expression: {exc}") from exc


def compile_rule(
    *, category_id: int, field: str, match_type: str, pattern: str, priority: int = 100, id: Optional[int] = None,
) -> CompiledRule:
    validate(field, match_type, pattern)
    text = pattern.strip()
    regex = re.compile(text, re.IGNORECASE) if match_type == "regex" else None
    # A merchant "contains" test compares against the normalised key, so the
    # needle is normalised the same way ("Netflix.com" → "netflix").
    needle = merchants.merchant_key(text) if field == "merchant" and match_type == "contains" else text.lower()
    return CompiledRule(id, category_id, field, match_type, text, priority, regex, needle or text.lower())


def compile_row(row: CategorizationRule) -> CompiledRule:
    return compile_rule(
        id=row.id, category_id=row.category_id, field=row.field, match_type=row.match_type,
        pattern=row.pattern, priority=row.priority,
    )


def active_rules(session: Session, user_id: int) -> list[CompiledRule]:
    """This user's active rules, best first, compiled once per session.

    Sync calls enrichment once per imported row; the cache keeps that from
    becoming one query per row. The cache lives on the session, so a request
    that edits rules (a different session) is never served stale rules.
    """
    cache = session.info.setdefault(_CACHE_KEY, {})
    if user_id in cache:
        return cache[user_id]
    rows = (
        session.query(CategorizationRule)
        .filter(CategorizationRule.user_id == user_id, CategorizationRule.is_active.is_(True))
        .order_by(CategorizationRule.priority.asc(), CategorizationRule.id.asc())
        .all()
    )
    compiled = []
    for row in rows:
        try:
            compiled.append(compile_row(row))
        except InvalidRule:
            # A row that stopped compiling (should not happen — validated on
            # write) is skipped rather than allowed to break every import.
            continue
    cache[user_id] = compiled
    return compiled


def invalidate(session: Session, user_id: int) -> None:
    session.info.get(_CACHE_KEY, {}).pop(user_id, None)


def first_match(rules: Iterable[CompiledRule], description: Optional[str], merchant_key: Optional[str]) -> Optional[CompiledRule]:
    for rule in rules:
        if rule.matches(description, merchant_key):
            return rule
    return None


def record_hit(session: Session, rule_id: Optional[int]) -> None:
    """Count a live match. Best effort and never a reason to fail a write."""
    if rule_id is None:
        return
    try:
        session.query(CategorizationRule).filter(CategorizationRule.id == rule_id).update(
            {CategorizationRule.applied_count: CategorizationRule.applied_count + 1},
            synchronize_session=False,
        )
    except Exception:
        pass


# ─── Preview and retroactive apply ───────────────────────────────────────────
@dataclass(frozen=True)
class PreviewRow:
    id: int
    description: Optional[str]
    amount: object
    transaction_date: object
    category_id: Optional[int]
    category_source: Optional[str]
    would_change: bool


@dataclass(frozen=True)
class Preview:
    matched: int
    would_change: int
    protected: int
    sample: list[PreviewRow]


def _candidates(session: Session, user_id: int):
    return (
        session.query(Transaction)
        .filter(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date.desc(), Transaction.id.desc())
    )


def _changeable(transaction: Transaction, category_id: int) -> bool:
    """Whether a retroactive apply may touch this row.

    Untouched: a category the user chose (`source == "user"`), and a row
    already filed where the rule points. Everything else — uncategorised or
    inferred — is fair game, which is what makes the apply idempotent: a
    second run finds nothing left to change.
    """
    if transaction.category_id == category_id:
        return False
    if transaction.category_id is not None and (transaction.category_source or "user") == "user":
        return False
    return True


def preview(session: Session, user_id: int, rule: CompiledRule, *, sample_size: int = 25, scan_limit: int = 5000) -> Preview:
    """What the rule would hit today, with a sample for the settings sheet.

    Scans the most recent `scan_limit` rows in Python. Regex and normalised
    merchant matching cannot use an index anyway, and the bound keeps a
    pathological pattern from walking a decade of history on every keystroke.
    """
    matched = would_change = protected = 0
    sample: list[PreviewRow] = []
    for tx in _candidates(session, user_id).limit(scan_limit):
        if not rule.matches(tx.description, tx.merchant_key):
            continue
        matched += 1
        changeable = _changeable(tx, rule.category_id)
        if changeable:
            would_change += 1
        elif tx.category_id != rule.category_id:
            protected += 1
        if len(sample) < sample_size:
            sample.append(PreviewRow(
                tx.id, tx.description, tx.amount, tx.transaction_date, tx.category_id, tx.category_source, changeable,
            ))
    return Preview(matched, would_change, protected, sample)


def apply_to_past(session: Session, user_id: int, row: CategorizationRule, *, scan_limit: int = 5000) -> int:
    """File every changeable past match under the rule's category. Stages only.

    Returns the number of rows changed. Idempotent: rows already at the
    rule's category, and rows the user categorised by hand, are skipped.
    """
    rule = compile_row(row)
    changed = 0
    for tx in _candidates(session, user_id).limit(scan_limit):
        if not rule.matches(tx.description, tx.merchant_key):
            continue
        if not _changeable(tx, rule.category_id):
            continue
        tx.category_id = rule.category_id
        tx.category_source = "rule"
        changed += 1
    if changed:
        row.applied_count = (row.applied_count or 0) + changed
    return changed


def category_belongs_to_user(session: Session, user_id: int, category_id: int) -> Optional[Category]:
    return (
        session.query(Category)
        .filter(Category.id == category_id, Category.user_id == user_id)
        .first()
    )
