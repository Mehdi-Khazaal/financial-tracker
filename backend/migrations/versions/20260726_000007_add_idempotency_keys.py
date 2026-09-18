"""Add idempotency_keys table.

Revision ID: 20260726_000007
Revises: 20260726_000006
Create Date: 2026-07-26 00:00:07
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260726_000007"
down_revision = "20260726_000006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idempotency_keys",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("key", sa.String(80), nullable=False, index=True),
        sa.Column("method", sa.String(10), nullable=False),
        sa.Column("path", sa.String(300), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False, index=True),
        sa.UniqueConstraint("user_id", "key", name="uq_idempotency_user_key"),
    )


def downgrade() -> None:
    op.drop_table("idempotency_keys")
