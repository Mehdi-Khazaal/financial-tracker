"""Daily assistant usage per user, for caps and the admin view.

Revision ID: 20260917_000019
Revises: 20260917_000018

New table only. Reversible: dropping it loses usage history, nothing else.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000019"
down_revision = "20260917_000018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "assistant_usage_daily" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "assistant_usage_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("turns", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "day", name="uq_assistant_usage_user_day"),
    )
    op.create_index("ix_assistant_usage_daily_id", "assistant_usage_daily", ["id"])
    op.create_index("ix_assistant_usage_daily_user_id", "assistant_usage_daily", ["user_id"])
    op.create_index("ix_assistant_usage_daily_day", "assistant_usage_daily", ["day"])


def downgrade() -> None:
    bind = op.get_bind()
    if "assistant_usage_daily" not in sa.inspect(bind).get_table_names():
        return
    op.drop_index("ix_assistant_usage_daily_day", table_name="assistant_usage_daily")
    op.drop_index("ix_assistant_usage_daily_user_id", table_name="assistant_usage_daily")
    op.drop_index("ix_assistant_usage_daily_id", table_name="assistant_usage_daily")
    op.drop_table("assistant_usage_daily")
