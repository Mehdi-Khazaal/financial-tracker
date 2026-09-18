"""Preserve recurring-relevant Plaid metadata on transactions.

Phase 5A foundation. Sync previously read Plaid's enrichment and discarded all
of it, storing only seven values per transaction. These columns retain the
subset that carries merchant identity or recurrence signal.

Every column is nullable with no server default: manual entries legitimately
have no Plaid data, and existing rows are backfilled separately by
`scripts/backfill_merchant_identity.py` rather than by this migration. Keeping
the DDL free of a table rewrite means it applies quickly on a live table.

Revision ID: 20260805_000009
Revises: 20260726_000008
Create Date: 2026-08-05 00:00:09
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260805_000009"
down_revision = "20260726_000008"
branch_labels = None
depends_on = None


# (name, type) for every column this migration adds.
_COLUMNS = [
    ("plaid_merchant_entity_id", sa.String(64)),
    ("plaid_merchant_name", sa.String(200)),
    ("original_description", sa.Text()),
    ("merchant_key", sa.String(120)),
    ("personal_finance_category_primary", sa.String(60)),
    ("personal_finance_category_detailed", sa.String(100)),
    ("category_source", sa.String(20)),
    ("payment_channel", sa.String(20)),
    ("transaction_code", sa.String(40)),
    ("authorized_date", sa.Date()),
    ("iso_currency_code", sa.String(8)),
]

_INDEXES = [
    ("ix_transactions_user_merchant_key", ["user_id", "merchant_key"]),
    ("ix_transactions_user_merchant_entity", ["user_id", "plaid_merchant_entity_id"]),
]


def _existing_columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("transactions")}


def _existing_indexes(bind) -> set[str]:
    return {idx["name"] for idx in sa.inspect(bind).get_indexes("transactions")}


def upgrade() -> None:
    # Guarded so the migration is safe to re-run against a database where an
    # earlier partial apply already added some columns.
    bind = op.get_bind()
    present = _existing_columns(bind)
    for name, type_ in _COLUMNS:
        if name not in present:
            op.add_column("transactions", sa.Column(name, type_, nullable=True))

    existing_indexes = _existing_indexes(bind)
    for index_name, columns in _INDEXES:
        if index_name not in existing_indexes:
            op.create_index(index_name, "transactions", columns)


def downgrade() -> None:
    bind = op.get_bind()
    existing_indexes = _existing_indexes(bind)
    for index_name, _ in _INDEXES:
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name="transactions")

    present = _existing_columns(bind)
    for name, _ in reversed(_COLUMNS):
        if name in present:
            op.drop_column("transactions", name)
