"""Add a revocable session version to users.

Revision ID: 20260714_000002
Revises: 20260612_000001
Create Date: 2026-07-14 00:00:02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260714_000002"
down_revision = "20260612_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "session_version")
