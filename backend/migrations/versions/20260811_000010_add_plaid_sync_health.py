"""Record how each Plaid Item is actually syncing.

The sync audit could not answer when Fintrack last *received* a webhook for an
Item. `/item/get` reports when Plaid last *sent* one; only a local record can
say whether it arrived, and the difference between those two is what separates
a webhook-registration problem from a delivery problem.

All columns are nullable with no server default and no backfill: they describe
events from now on, and inventing values for the past would be worse than
leaving them null. Writes are best-effort and never gate a sync.

Revision ID: 20260811_000010
Revises: 20260805_000009
Create Date: 2026-08-11 00:00:10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260811_000010"
down_revision = "20260805_000009"
branch_labels = None
depends_on = None


_COLUMNS = [
    ("last_webhook_at", sa.DateTime()),
    ("last_webhook_code", sa.String(60)),
    ("last_sync_at", sa.DateTime()),
    ("last_sync_source", sa.String(20)),
    ("last_sync_ok", sa.Boolean()),
    ("last_sync_error", sa.String(300)),
    ("last_added_count", sa.Integer()),
    ("last_modified_count", sa.Integer()),
    ("last_removed_count", sa.Integer()),
]


def _existing_columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("plaid_items")}


def upgrade() -> None:
    # Guarded so a partial apply can be re-run safely.
    present = _existing_columns(op.get_bind())
    for name, type_ in _COLUMNS:
        if name not in present:
            op.add_column("plaid_items", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    present = _existing_columns(op.get_bind())
    for name, _ in reversed(_COLUMNS):
        if name in present:
            op.drop_column("plaid_items", name)
