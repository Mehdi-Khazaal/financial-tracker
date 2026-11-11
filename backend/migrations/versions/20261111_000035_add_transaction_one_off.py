"""Mark a transaction as a one-off, or as routine.

Revision ID: 20261111_000035
Revises: 20261110_000034

One additive, nullable column. Null means automatic: a charge of $1,000 or
more that does not repeat counts as a one-off (`services/one_offs.py`) and is
left out of the usual month the goal plan funds goals from. True or false is
the user's own call and overrides the rule either way. Reversible: dropping
the column loses only those overrides.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261111_000035"
down_revision = "20261110_000034"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns("transactions")}


def upgrade() -> None:
    if "one_off" not in _columns(op.get_bind()):
        with op.batch_alter_table("transactions") as batch:
            batch.add_column(sa.Column("one_off", sa.Boolean(), nullable=True))


def downgrade() -> None:
    if "one_off" in _columns(op.get_bind()):
        with op.batch_alter_table("transactions") as batch:
            batch.drop_column("one_off")
