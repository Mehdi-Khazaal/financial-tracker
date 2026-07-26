"""Add merchant canonical + alias tables for merchant normalization.

Revision ID: 20260726_000006
Revises: 20260726_000005
Create Date: 2026-07-26 00:00:06
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260726_000006"
down_revision = "20260726_000005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "merchants_canonical",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True, index=True),
        sa.Column("default_category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "merchant_aliases",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("raw_name", sa.String(200), nullable=False, unique=True, index=True),
        sa.Column("canonical_id", sa.Integer(), sa.ForeignKey("merchants_canonical.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("merchant_aliases")
    op.drop_table("merchants_canonical")
