"""Backfill merchant identity and category suggestions over existing rows.

Transactions written before Phase 5A have a null `merchant_key`, so they are
invisible to the indexed merchant lookup and contribute nothing to category
suggestion. This script fills that in.

    # Report only; writes nothing. Always run this first.
    python -m scripts.backfill_merchant_identity --dry-run

    # Keys and aliases only; no category assignment at all.
    python -m scripts.backfill_merchant_identity --apply --no-categories

    # Full run, one user, resumable.
    python -m scripts.backfill_merchant_identity --apply --user-id 42

    # Resume after an interruption.
    python -m scripts.backfill_merchant_identity --apply --start-id 918274

What it will **not** do:

  * Change any amount, date, account, or Plaid ID. It writes exactly three
    columns: `merchant_key`, `category_id`, `category_source`.
  * Overwrite a category that is already set. Any row with a non-null
    `category_id` keeps it, whoever put it there.
  * Invent Plaid data. `plaid_merchant_name` and `original_description` were
    never stored for historical rows and cannot be recovered without
    re-fetching from Plaid, so they are left null rather than guessed at from
    `description`. A future re-sync will populate them for rows Plaid still
    returns.
  * Create categories or merchants that do not already exist beyond the
    canonical/alias rows normalization itself implies.

Idempotency: only rows with a null `merchant_key` are considered for keying,
and only rows with a null `category_id` for categorization. A second run over
the same data therefore inspects fewer rows and changes nothing. Safe to
re-run after an interruption, and safe to run while the app is serving.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Allow `python scripts/backfill_merchant_identity.py` as well as `-m`.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session

from models.database import SessionLocal, Transaction
from services import merchants
from services.transaction_enrichment import (
    resolve_transaction_merchant,
    suggest_transaction_category,
)

DEFAULT_BATCH_SIZE = 500


@dataclass
class BackfillReport:
    rows_inspected: int = 0
    merchant_keys_generated: int = 0
    aliases_created: int = 0
    categories_suggested: int = 0
    categories_assigned: int = 0
    ambiguous_skipped: int = 0
    unresolvable_skipped: int = 0
    already_categorized: int = 0
    last_id_processed: int = 0
    _distinct_keys: set[str] = field(default_factory=set)

    def render(self, *, dry_run: bool) -> str:
        # ASCII only: this prints to a console, and Windows' default cp1252
        # codepage cannot encode box-drawing characters or an em dash.
        mode = "DRY RUN - no changes written" if dry_run else "APPLIED"
        return "\n".join([
            "",
            f"  Backfill report ({mode})",
            "  " + "-" * 52,
            f"  Rows inspected              {self.rows_inspected:>10,}",
            f"  Merchant keys generated     {self.merchant_keys_generated:>10,}",
            f"    distinct merchants        {len(self._distinct_keys):>10,}",
            f"  Aliases created             {self.aliases_created:>10,}",
            f"  Categories suggested        {self.categories_suggested:>10,}",
            f"  Categories assigned         {self.categories_assigned:>10,}",
            f"  Ambiguous rows skipped      {self.ambiguous_skipped:>10,}",
            f"  Unresolvable descriptions   {self.unresolvable_skipped:>10,}",
            f"  Already categorized         {self.already_categorized:>10,}",
            f"  Last transaction id         {self.last_id_processed:>10,}",
            "",
        ])


def _iter_batches(
    session: Session,
    *,
    user_id: int | None,
    start_id: int,
    batch_size: int,
):
    """Yield transactions in ascending id order, keyset-paginated.

    Keyset rather than OFFSET so the walk stays correct and cheap while rows
    are being inserted underneath it.
    """
    last_id = start_id
    while True:
        query = session.query(Transaction).filter(Transaction.id > last_id)
        if user_id is not None:
            query = query.filter(Transaction.user_id == user_id)
        rows = query.order_by(Transaction.id).limit(batch_size).all()
        if not rows:
            return
        yield rows
        last_id = rows[-1].id


def run_backfill(
    session: Session,
    *,
    dry_run: bool = True,
    user_id: int | None = None,
    start_id: int = 0,
    batch_size: int = DEFAULT_BATCH_SIZE,
    assign_categories: bool = True,
    verbose: bool = False,
) -> BackfillReport:
    """Walk transactions, filling merchant identity and safe category guesses."""
    report = BackfillReport()

    for batch in _iter_batches(
        session, user_id=user_id, start_id=start_id, batch_size=batch_size
    ):
        for row in batch:
            report.rows_inspected += 1
            report.last_id_processed = row.id

            identity = resolve_transaction_merchant(
                row.description,
                plaid_merchant_entity_id=row.plaid_merchant_entity_id,
            )

            # ── Merchant key ──────────────────────────────────────────────
            if row.merchant_key is None and identity.key:
                report.merchant_keys_generated += 1
                report._distinct_keys.add(identity.key)
                if not dry_run:
                    row.merchant_key = identity.key
                if row.description:
                    if _register_alias(session, row.description, dry_run=dry_run):
                        report.aliases_created += 1
            elif row.merchant_key is None and not identity.key:
                # Description is blank or entirely transaction noise. Nothing
                # to key on; left null so a later, better normalizer can try.
                report.unresolvable_skipped += 1

            # ── Category ──────────────────────────────────────────────────
            if row.category_id is not None:
                report.already_categorized += 1
                continue
            if not assign_categories:
                continue

            # Vote against the identity we just derived, even in dry-run where
            # the key is not yet persisted.
            suggested, source = suggest_transaction_category(
                session,
                row.user_id,
                identity,
                pfc_primary=row.personal_finance_category_primary,
            )
            if suggested is None:
                report.ambiguous_skipped += 1
                continue

            report.categories_suggested += 1
            if not dry_run:
                row.category_id = suggested
                row.category_source = source
                report.categories_assigned += 1
            if verbose:
                print(f"    tx {row.id}: {row.description!r} → category {suggested} ({source})")

        if not dry_run:
            # Commit per batch so an interruption loses at most one batch, and
            # so `--start-id` can resume from `last_id_processed`.
            session.commit()
        else:
            # Discard staged changes; `resolve_or_create` may have flushed
            # canonical rows while probing.
            session.rollback()

    return report


def _register_alias(session: Session, description: str, *, dry_run: bool) -> bool:
    """Ensure a canonical/alias pair exists. Returns True when one was added.

    In dry-run the caller rolls back, so this reports what *would* be created
    without leaving anything behind.
    """
    try:
        from models.database import MerchantAlias

        existing = (
            session.query(MerchantAlias)
            .filter(MerchantAlias.raw_name == description)
            .one_or_none()
        )
        if existing is not None:
            return False
        merchants.resolve_or_create(session, description)
        return True
    except Exception:
        # An alias problem must never abort the walk — the merchant key, which
        # is what actually matters downstream, is written independently.
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Report only; write nothing (default).")
    mode.add_argument("--apply", action="store_true", help="Write changes.")
    parser.add_argument("--user-id", type=int, default=None, help="Restrict to one user.")
    parser.add_argument("--start-id", type=int, default=0, help="Resume after this transaction id.")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--no-categories", action="store_true", help="Keys and aliases only.")
    parser.add_argument("--verbose", action="store_true", help="Print each category assignment.")
    args = parser.parse_args(argv)

    dry_run = not args.apply

    session = SessionLocal()
    try:
        report = run_backfill(
            session,
            dry_run=dry_run,
            user_id=args.user_id,
            start_id=args.start_id,
            batch_size=args.batch_size,
            assign_categories=not args.no_categories,
            verbose=args.verbose,
        )
    finally:
        session.close()

    print(report.render(dry_run=dry_run))
    if dry_run:
        print("  Re-run with --apply to write these changes.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
