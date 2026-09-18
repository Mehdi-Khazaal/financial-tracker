"""Per-identifier login lockout bookkeeping.

Revision ID: 20260917_000014
Revises: 20260916_000013

A new table, nothing else. `create_all()` provisions it at startup on
deployments that still rely on boot-time preparation; this revision is what
`alembic upgrade head` applies everywhere else. Reversible: dropping the table
loses only lockout counters, which regenerate on the next failed login.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000014"
down_revision = "20260916_000013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "auth_failures" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "auth_failures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("identifier", sa.String(320), nullable=False),
        sa.Column("failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_failure_at", sa.DateTime(), nullable=True),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_failures_identifier", "auth_failures", ["identifier"], unique=True)
    op.create_index("ix_auth_failures_id", "auth_failures", ["id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "auth_failures" not in sa.inspect(bind).get_table_names():
        return
    op.drop_index("ix_auth_failures_id", table_name="auth_failures")
    op.drop_index("ix_auth_failures_identifier", table_name="auth_failures")
    op.drop_table("auth_failures")
