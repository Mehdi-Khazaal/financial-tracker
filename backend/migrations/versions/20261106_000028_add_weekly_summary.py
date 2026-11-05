"""Weekly summary preference and its once-a-week marker.

Revision ID: 20261106_000028
Revises: 20261104_000027

Additive columns. The summary defaults on: it only reaches people who have
already turned on notifications, and it is one push a week. The marker is a
nullable date, so existing rows simply have never been sent one.
Reversible: dropping the columns loses only the setting and the marker.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261106_000028"
down_revision = "20261104_000027"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    prefs = _columns(op.get_bind(), "user_preferences")
    with op.batch_alter_table("user_preferences") as batch:
        if "weekly_summary_enabled" not in prefs:
            batch.add_column(sa.Column("weekly_summary_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")))
        if "weekly_summary_sent_on" not in prefs:
            batch.add_column(sa.Column("weekly_summary_sent_on", sa.Date(), nullable=True))


def downgrade() -> None:
    prefs = _columns(op.get_bind(), "user_preferences")
    with op.batch_alter_table("user_preferences") as batch:
        for name in ("weekly_summary_sent_on", "weekly_summary_enabled"):
            if name in prefs:
                batch.drop_column(name)
