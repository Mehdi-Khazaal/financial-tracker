"""Add jobs table for the Postgres-backed background queue.

Revision ID: 20260726_000008
Revises: 20260726_000007
Create Date: 2026-07-26 00:00:08
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260726_000008"
down_revision = "20260726_000007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("kind", sa.String(80), nullable=False, index=True),
        sa.Column("payload", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("run_at", sa.DateTime(), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending", index=True),
        sa.Column("tries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("jobs")
