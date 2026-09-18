"""Reconcile the migration chain with the models.

Revision ID: 20260918_000026
Revises: 20260918_000025

A Postgres drift check (`scripts/check_schema_drift.py`) found five places
where a database built by this chain differs from one built from the models —
which is how production was built, by the legacy boot-time repairs. Every
step here inspects first and only acts when the object is missing or in the
other shape, so it is safe on both kinds of database:

* `ix_snapshot_user_date` (user_id, snapshot_date): created by revision 5 but
  never declared on the model, so production never had it. Now declared, and
  created here where absent — the per-user snapshot range scan uses it.
* `recurring_transactions.last_transaction_id` → `transactions.id` ON DELETE
  SET NULL: declared on the model, missing from the chain.
* `ix_assistant_pending_actions_id`, `ix_recurring_dismissals_id`,
  `ix_user_preferences_id`: primary-key indexes every other table has.
* `user_preferences.user_id` uniqueness: the chain used a named unique
  constraint plus a plain index; the model (and production) use one unique
  index. Same guarantee, one object.

Nothing here touches data.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260918_000026"
down_revision = "20260918_000025"
branch_labels = None
depends_on = None

FK_NAME = "fk_recurring_transactions_last_transaction_id"


def _inspector():
    return sa.inspect(op.get_bind())


def _indexes(table: str) -> dict:
    return {index["name"]: index for index in _inspector().get_indexes(table)}


def _has_fk(table: str, column: str, referred: str) -> bool:
    return any(
        fk["constrained_columns"] == [column] and fk["referred_table"] == referred
        for fk in _inspector().get_foreign_keys(table)
    )


def _unique_constraints(table: str) -> set:
    return {uc["name"] for uc in _inspector().get_unique_constraints(table) if uc.get("name")}


def upgrade() -> None:
    if "ix_snapshot_user_date" not in _indexes("account_balance_snapshots"):
        op.create_index("ix_snapshot_user_date", "account_balance_snapshots", ["user_id", "snapshot_date"])

    for table in ("assistant_pending_actions", "recurring_dismissals", "user_preferences"):
        name = f"ix_{table}_id"
        if name not in _indexes(table):
            op.create_index(name, table, ["id"])

    if not _has_fk("recurring_transactions", "last_transaction_id", "transactions"):
        with op.batch_alter_table("recurring_transactions") as batch:
            batch.create_foreign_key(FK_NAME, "transactions", ["last_transaction_id"], ["id"], ondelete="SET NULL")

    indexes = _indexes("user_preferences")
    user_index = indexes.get("ix_user_preferences_user_id")
    if user_index is None or not user_index.get("unique"):
        if user_index is not None:
            op.drop_index("ix_user_preferences_user_id", table_name="user_preferences")
        op.create_index("ix_user_preferences_user_id", "user_preferences", ["user_id"], unique=True)
    if "uq_user_preferences_user_id" in _unique_constraints("user_preferences"):
        with op.batch_alter_table("user_preferences") as batch:
            batch.drop_constraint("uq_user_preferences_user_id", type_="unique")


def downgrade() -> None:
    """Back to the chain's revision-25 shape. `ix_snapshot_user_date` stays:
    the chain has had it since revision 5."""
    if "uq_user_preferences_user_id" not in _unique_constraints("user_preferences"):
        with op.batch_alter_table("user_preferences") as batch:
            batch.create_unique_constraint("uq_user_preferences_user_id", ["user_id"])
    user_index = _indexes("user_preferences").get("ix_user_preferences_user_id")
    if user_index is not None and user_index.get("unique"):
        op.drop_index("ix_user_preferences_user_id", table_name="user_preferences")
        op.create_index("ix_user_preferences_user_id", "user_preferences", ["user_id"])

    if _has_fk("recurring_transactions", "last_transaction_id", "transactions"):
        names = [
            fk["name"] for fk in _inspector().get_foreign_keys("recurring_transactions")
            if fk["constrained_columns"] == ["last_transaction_id"] and fk.get("name")
        ]
        if names:
            with op.batch_alter_table("recurring_transactions") as batch:
                batch.drop_constraint(names[0], type_="foreignkey")

    for table in ("assistant_pending_actions", "recurring_dismissals", "user_preferences"):
        name = f"ix_{table}_id"
        if name in _indexes(table):
            op.drop_index(name, table_name=table)
