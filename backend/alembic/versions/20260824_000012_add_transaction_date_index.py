"""Index transactions on (user_id, transaction_date).

Revision ID: 20260824_000012
Revises: 20260823_000011

The ledger, the month picker and every analytics range read transactions with
`WHERE user_id = ? ORDER BY transaction_date DESC`. Nothing indexed that sort.
The two existing composite indexes both start with `user_id` but carry a
different second column, so Postgres could narrow to the user and then had to
sort every one of their rows on each request.

Additive and reversible: an index changes only how the same rows are found.
Created without CONCURRENTLY because Alembic wraps a migration in a
transaction; on a table this size the brief lock is not worth the extra
machinery, and `main.py` creates the same index at startup with IF NOT EXISTS
so whichever path runs first wins and the other is a no-op.
"""

from alembic import op


revision = "20260824_000012"
down_revision = "20260823_000011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_transactions_user_date", "transactions", ["user_id", "transaction_date"]
    )


def downgrade() -> None:
    op.drop_index("ix_transactions_user_date", table_name="transactions")
