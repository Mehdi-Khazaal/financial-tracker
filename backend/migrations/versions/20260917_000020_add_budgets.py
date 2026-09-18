"""Monthly per-category budgets.

Revision ID: 20260917_000020
Revises: 20260917_000019

New table only; progress is computed from the ledger, never stored.
Reversible: dropping the table removes the limits, not any transaction.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000020"
down_revision = "20260917_000019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "budgets" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("rollover", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notified_month", sa.String(7), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "category_id", name="uq_budgets_user_category"),
    )
    op.create_index("ix_budgets_id", "budgets", ["id"])
    op.create_index("ix_budgets_user_id", "budgets", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "budgets" not in sa.inspect(bind).get_table_names():
        return
    op.drop_index("ix_budgets_user_id", table_name="budgets")
    op.drop_index("ix_budgets_id", table_name="budgets")
    op.drop_table("budgets")
