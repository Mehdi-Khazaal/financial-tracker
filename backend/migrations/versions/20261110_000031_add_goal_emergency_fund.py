"""Mark the savings goal that is the emergency fund.

Revision ID: 20261110_000031
Revises: 20261110_000030

One additive column. Money set aside for any other goal is promised to it, so
the app now leaves it out of "available to spend" and of the emergency-fund
cover; the emergency fund's own money still counts as cover.

Existing goals whose name says "emergency" are marked, because that is what
their owners meant; anyone can change it on the goal afterwards.
Reversible: dropping the column loses only the mark.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261110_000031"
down_revision = "20261110_000030"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "is_emergency_fund" not in _columns(bind, "savings_goals"):
        with op.batch_alter_table("savings_goals") as batch:
            batch.add_column(sa.Column("is_emergency_fund", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    bind.execute(sa.text(
        "UPDATE savings_goals SET is_emergency_fund = :yes WHERE lower(name) LIKE '%emergency%'"
    ), {"yes": True})


def downgrade() -> None:
    if "is_emergency_fund" in _columns(op.get_bind(), "savings_goals"):
        with op.batch_alter_table("savings_goals") as batch:
            batch.drop_column("is_emergency_fund")
