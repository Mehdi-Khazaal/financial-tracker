"""Recurring bills remodel: groups, bank matching, alerts, dismissals.

Revision ID: 20260916_000013
Revises: 20260824_000012

Every new column on `recurring_transactions` is nullable with no server
default. Existing rows keep working unchanged: a null `group_key` is derived
on read, a null identity is resolved from `description`, and null alert
bookkeeping simply means nothing has been sent yet.

`recurring_dismissals` is a new table, so `create_all()` provisions it at
startup on Render; the column additions are mirrored in `main.py`.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260916_000013"
down_revision = "20260824_000012"
branch_labels = None
depends_on = None


_COLUMNS = [
    ("group_key", sa.String(30)),
    ("source", sa.String(20)),
    ("plaid_merchant_entity_id", sa.String(64)),
    ("merchant_key", sa.String(120)),
    ("last_paid_date", sa.Date()),
    ("last_paid_amount", sa.Numeric(15, 2)),
    ("last_transaction_id", sa.Integer()),
    ("previous_amount", sa.Numeric(15, 2)),
    ("amount_changed_on", sa.Date()),
    ("reminder_sent_for", sa.Date()),
    ("missed_alert_sent_for", sa.Date()),
    ("price_alert_sent_on", sa.Date()),
    ("updated_at", sa.DateTime()),
]


def _existing_columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("recurring_transactions")}


def upgrade() -> None:
    bind = op.get_bind()
    present = _existing_columns(bind)
    for name, type_ in _COLUMNS:
        if name not in present:
            op.add_column("recurring_transactions", sa.Column(name, type_, nullable=True))

    if "recurring_dismissals" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "recurring_dismissals",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("identity", sa.String(200), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "identity", name="uq_recurring_dismissals_user_identity"),
        )
        op.create_index("ix_recurring_dismissals_user_id", "recurring_dismissals", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "recurring_dismissals" in sa.inspect(bind).get_table_names():
        op.drop_index("ix_recurring_dismissals_user_id", table_name="recurring_dismissals")
        op.drop_table("recurring_dismissals")
    present = _existing_columns(bind)
    for name, _ in reversed(_COLUMNS):
        if name in present:
            op.drop_column("recurring_transactions", name)
