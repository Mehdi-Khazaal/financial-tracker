"""Add `users.timezone`, previously only added by the boot-time repairs.

Revision ID: 20260917_000018
Revises: 20260917_000017

The last column that existed in the ORM and in `main._prepare_database()` but
in no revision. A database built from the chain alone could not sign a user
up (the INSERT named a column the table lacked). Guarded: every deployment
that has run the app already has the column, so this is a no-op there.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000018"
down_revision = "20260917_000017"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("users")}


def upgrade() -> None:
    if "timezone" in _columns(op.get_bind()):
        return
    op.add_column("users", sa.Column("timezone", sa.String(64), nullable=True))


def downgrade() -> None:
    if "timezone" not in _columns(op.get_bind()):
        return
    op.drop_column("users", "timezone")
