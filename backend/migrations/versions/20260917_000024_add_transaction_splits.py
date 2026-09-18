"""Split transactions.

Revision ID: 20260917_000024
Revises: 20260917_000023

New table only. Lines say how a transaction's amount is filed; they never
move money, so dropping the table removes the filing and nothing else.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000024"
down_revision = "20260917_000023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "transaction_splits" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "transaction_splits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transaction_splits_id", "transaction_splits", ["id"])
    op.create_index("ix_transaction_splits_transaction_id", "transaction_splits", ["transaction_id"])
    op.create_index("ix_transaction_splits_user_category", "transaction_splits", ["user_id", "category_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "transaction_splits" not in sa.inspect(bind).get_table_names():
        return
    op.drop_index("ix_transaction_splits_user_category", table_name="transaction_splits")
    op.drop_index("ix_transaction_splits_transaction_id", table_name="transaction_splits")
    op.drop_index("ix_transaction_splits_id", table_name="transaction_splits")
    op.drop_table("transaction_splits")
