"""Stored market prices, one row per symbol.

Revision ID: 20261110_000029
Revises: 20261106_000028

A new table only. Prices are public data and refetched on demand, so dropping
the table loses nothing that cannot be fetched again.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261110_000029"
down_revision = "20261106_000028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "market_prices" not in tables:
        op.create_table(
            "market_prices",
            sa.Column("key", sa.String(40), nullable=False),
            sa.Column("price", sa.Numeric(18, 6), nullable=False),
            sa.Column("change_pct", sa.Numeric(9, 4), nullable=True),
            sa.Column("fetched_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("key"),
        )


def downgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "market_prices" in tables:
        op.drop_table("market_prices")
