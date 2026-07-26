"""Add updated_at to transactions, categories, savings_goals for ETag support.

Revision ID: 20260726_000004
Revises: 20260714_000003
Create Date: 2026-07-26 00:00:04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260726_000004"
down_revision = "20260714_000003"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    for table in ("transactions", "categories", "savings_goals"):
        if "updated_at" not in _column_names(table):
            op.add_column(table, sa.Column("updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    for table in ("savings_goals", "categories", "transactions"):
        if "updated_at" in _column_names(table):
            op.drop_column(table, "updated_at")
