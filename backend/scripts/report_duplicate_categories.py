"""Report categories that would collide under the Phase 6B uniqueness rule.

    python -m scripts.report_duplicate_categories

**This script writes nothing.** It has no `--apply`, no `--fix` and no
destructive mode at all, by design: merging two categories means repointing
transactions from one onto the other, and deciding which name survives is a
judgement about the user's own records that a script has no business making
unattended.

Why it exists
-------------
Phase 6B enforces one name per `(user, type, normalized name)` — trimmed and
compared case-insensitively — in the API. It deliberately does *not* add a
database unique index, because an index cannot be created while violating rows
exist, and duplicates were creatable for the whole life of the product:

  * there was never a uniqueness constraint or a normalization step on write;
  * default categories are seeded per user with a real `user_id`, so a custom
    "Groceries" sits in the same namespace as the seeded one and both were
    accepted.

Run this against production before considering an index. If it reports nothing,
the index is safe to add. If it reports rows, they need a decision per group
first — and that decision is the user's.

Reading the output
------------------
Each group lists the rows that share a normalized key. `transactions` and
`recurring` are the counts that would be affected by deleting that row: both
foreign keys are ON DELETE SET NULL, so those records survive and become
uncategorized rather than being reassigned.

Exit status is 0 when clean and 1 when duplicates were found, so it can gate a
migration step in a deploy script.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func  # noqa: E402

from models.database import Category, RecurringTransaction, SessionLocal, Transaction  # noqa: E402


def normalized(name: str | None) -> str:
    """The key the API compares on: trimmed, lower-cased."""
    return (name or "").strip().lower()


def find_duplicate_groups(session, user_id: int | None = None) -> list[dict]:
    query = session.query(Category)
    if user_id is not None:
        query = query.filter(Category.user_id == user_id)

    grouped: dict[tuple, list[Category]] = defaultdict(list)
    for category in query.all():
        grouped[(category.user_id, category.type, normalized(category.name))].append(category)

    groups = []
    for (owner, category_type, key), rows in sorted(grouped.items(), key=lambda item: str(item[0])):
        if len(rows) < 2:
            continue
        groups.append({
            "user_id": owner,
            "type": category_type,
            "key": key,
            "rows": sorted(rows, key=lambda row: row.id),
        })
    return groups


def _usage(session, category_id: int) -> tuple[int, int]:
    transactions = (
        session.query(func.count(Transaction.id))
        .filter(Transaction.category_id == category_id)
        .scalar()
    ) or 0
    recurring = (
        session.query(func.count(RecurringTransaction.id))
        .filter(RecurringTransaction.category_id == category_id)
        .scalar()
    ) or 0
    return transactions, recurring


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--user-id", type=int, default=None, help="Limit to one user.")
    args = parser.parse_args(argv)

    session = SessionLocal()
    try:
        groups = find_duplicate_groups(session, args.user_id)

        if not groups:
            print("No duplicate category names found.")
            print("A unique index on (user_id, type, lower(name)) would apply cleanly.")
            return 0

        print(f"Found {len(groups)} colliding group(s).\n")
        for group in groups:
            print(f"user {group['user_id']}  {group['type']}  \"{group['key']}\"")
            for row in group["rows"]:
                transactions, recurring = _usage(session, row.id)
                flag = "default" if row.is_system else "custom "
                print(
                    f"    id={row.id:<6} {flag}  name={row.name!r:<28}"
                    f" transactions={transactions:<6} recurring={recurring}"
                )
            print()

        print("Nothing was changed. Decide per group before adding a unique index;")
        print("deleting a category leaves its transactions uncategorized, not reassigned.")
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
