"""Alert preferences and the low-balance marker.

Revision ID: 20260917_000022
Revises: 20260917_000021

Additive columns with server defaults that preserve today's behaviour: bill
reminders and budget alerts stay on, low-balance alerts start off.
Reversible: dropping the columns loses only the settings.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000022"
down_revision = "20260917_000021"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    prefs = _columns(bind, "user_preferences")
    with op.batch_alter_table("user_preferences") as batch:
        if "bill_reminders_enabled" not in prefs:
            batch.add_column(sa.Column("bill_reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")))
        if "budget_alerts_enabled" not in prefs:
            batch.add_column(sa.Column("budget_alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")))
        if "low_balance_alerts_enabled" not in prefs:
            batch.add_column(sa.Column("low_balance_alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
        if "low_balance_threshold" not in prefs:
            batch.add_column(sa.Column("low_balance_threshold", sa.Numeric(15, 2), nullable=False, server_default="100"))
    accounts = _columns(bind, "accounts")
    if "low_balance_notified_on" not in accounts:
        with op.batch_alter_table("accounts") as batch:
            batch.add_column(sa.Column("low_balance_notified_on", sa.Date(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    accounts = _columns(bind, "accounts")
    if "low_balance_notified_on" in accounts:
        with op.batch_alter_table("accounts") as batch:
            batch.drop_column("low_balance_notified_on")
    prefs = _columns(bind, "user_preferences")
    with op.batch_alter_table("user_preferences") as batch:
        for name in ("low_balance_threshold", "low_balance_alerts_enabled", "budget_alerts_enabled", "bill_reminders_enabled"):
            if name in prefs:
                batch.drop_column(name)
