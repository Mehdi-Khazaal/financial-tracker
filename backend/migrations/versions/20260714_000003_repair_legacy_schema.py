"""Repair columns missing from legacy production databases.

Revision ID: 20260714_000003
Revises: 20260714_000002
Create Date: 2026-07-14 00:00:03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260714_000003"
down_revision = "20260714_000002"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    account_columns = _column_names("accounts")
    if "credit_limit" not in account_columns:
        op.add_column("accounts", sa.Column("credit_limit", sa.Numeric(15, 2), nullable=True))

    asset_columns = _column_names("assets")
    if "asset_class" not in asset_columns:
        op.add_column(
            "assets",
            sa.Column("asset_class", sa.String(20), nullable=False, server_default="physical"),
        )
        op.execute(
            """UPDATE assets
               SET asset_class = 'investment'
               WHERE LOWER(type) IN ('stock', 'crypto', 'gold', 'silver', 'etf', 'bond')"""
        )

    category_columns = _column_names("categories")
    if "user_id" not in category_columns:
        op.add_column("categories", sa.Column("user_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_categories_user_id_users",
            "categories",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if "is_system" not in category_columns:
        op.add_column(
            "categories",
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    # These columns may predate Alembic on upgraded installations. Removing
    # them would risk deleting user data, so this repair is intentionally
    # irreversible.
    pass
