"""Materialized account balance snapshots.

Revision ID: 20260726_000005
Revises: 20260726_000004
Create Date: 2026-07-26 00:00:05
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260726_000005"
down_revision = "20260726_000004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_balance_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("snapshot_date", sa.Date(), nullable=False, index=True),
        sa.Column("closing_balance", sa.Numeric(15, 2), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("account_id", "snapshot_date", name="uq_snapshot_account_date"),
    )
    op.create_index(
        "ix_snapshot_user_date",
        "account_balance_snapshots",
        ["user_id", "snapshot_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_snapshot_user_date", table_name="account_balance_snapshots")
    op.drop_table("account_balance_snapshots")
