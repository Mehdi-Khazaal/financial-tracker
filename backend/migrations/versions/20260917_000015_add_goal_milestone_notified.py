"""Remember which savings-goal milestone was last announced.

Revision ID: 20260917_000015
Revises: 20260917_000014

One nullable-by-default-then-filled column. Existing goals start at 0, so the
next allocation that sits above a milestone announces it once and then goes
quiet, instead of announcing it on every save as before. Mirrored in
`main.py`'s boot-time list for deployments that still rely on it.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000015"
down_revision = "20260917_000014"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("savings_goals")}


def upgrade() -> None:
    if "milestone_notified" in _columns(op.get_bind()):
        return
    op.add_column(
        "savings_goals",
        sa.Column("milestone_notified", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    if "milestone_notified" not in _columns(op.get_bind()):
        return
    op.drop_column("savings_goals", "milestone_notified")
