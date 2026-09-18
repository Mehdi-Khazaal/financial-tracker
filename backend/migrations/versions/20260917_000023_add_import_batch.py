"""Import batch id on transactions, so a CSV import can be undone as a unit.

Revision ID: 20260917_000023
Revises: 20260917_000022

Additive, nullable. Reversible: dropping the column loses only the grouping.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000023"
down_revision = "20260917_000022"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "import_batch_id" in _columns(bind, "transactions"):
        return
    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("import_batch_id", sa.String(32), nullable=True))
    op.create_index("ix_transactions_user_import_batch", "transactions", ["user_id", "import_batch_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "import_batch_id" not in _columns(bind, "transactions"):
        return
    op.drop_index("ix_transactions_user_import_batch", table_name="transactions")
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("import_batch_id")
