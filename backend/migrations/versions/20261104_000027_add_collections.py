"""Collections: named groups of transactions (a trip, a holiday, a move).

Revision ID: 20261104_000027
Revises: 20260918_000026

New tables only. A collection groups transactions without changing them, so
dropping both tables removes the grouping and nothing else.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261104_000027"
down_revision = "20260918_000026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "collections" not in tables:
        op.create_table(
            "collections",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(60), nullable=False),
            sa.Column("emoji", sa.String(16), nullable=True),
            sa.Column("color", sa.String(7), nullable=True),
            sa.Column("note", sa.String(500), nullable=True),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("budget", sa.Numeric(15, 2), nullable=True),
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("suggestions_reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "name", name="uq_collections_user_name"),
        )
        op.create_index("ix_collections_id", "collections", ["id"])
        op.create_index("ix_collections_user_id", "collections", ["user_id"])
    if "collection_transactions" not in tables:
        op.create_table(
            "collection_transactions",
            sa.Column("collection_id", sa.Integer(), nullable=False),
            sa.Column("transaction_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("collection_id", "transaction_id"),
        )
        op.create_index("ix_collection_transactions_transaction_id", "collection_transactions", ["transaction_id"])
        op.create_index("ix_collection_transactions_user_id", "collection_transactions", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "collection_transactions" in tables:
        op.drop_index("ix_collection_transactions_user_id", table_name="collection_transactions")
        op.drop_index("ix_collection_transactions_transaction_id", table_name="collection_transactions")
        op.drop_table("collection_transactions")
    if "collections" in tables:
        op.drop_index("ix_collections_user_id", table_name="collections")
        op.drop_index("ix_collections_id", table_name="collections")
        op.drop_table("collections")
