"""Price a holding by its metal: metal, weight and purity on assets.

Revision ID: 20261110_000032
Revises: 20261110_000031

Additive, nullable columns. With all three set, a holding is valued at the
metal it contains at today's price instead of the value recorded for it.
Reversible: dropping the columns returns every holding to its recorded value.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261110_000032"
down_revision = "20261110_000031"
branch_labels = None
depends_on = None

COLUMNS = (
    ("metal", sa.String(10)),
    ("weight_grams", sa.Numeric(14, 7)),
    ("purity", sa.Numeric(6, 4)),
)


def _columns(bind) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns("assets")}


def upgrade() -> None:
    have = _columns(op.get_bind())
    with op.batch_alter_table("assets") as batch:
        for name, kind in COLUMNS:
            if name not in have:
                batch.add_column(sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    have = _columns(op.get_bind())
    with op.batch_alter_table("assets") as batch:
        for name, _ in reversed(COLUMNS):
            if name in have:
                batch.drop_column(name)
