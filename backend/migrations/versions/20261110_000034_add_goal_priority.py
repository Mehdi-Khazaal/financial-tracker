"""The order savings goals are funded in.

Revision ID: 20261110_000034
Revises: 20261110_000033

One additive column. Existing goals are numbered per user by deadline (the
soonest first, goals without one last), then by when they were created: the
order a person would most likely fund them in. The user can reorder them.
Reversible: dropping the column loses only the order.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261110_000034"
down_revision = "20261110_000033"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns("savings_goals")}


def upgrade() -> None:
    bind = op.get_bind()
    if "priority" not in _columns(bind):
        with op.batch_alter_table("savings_goals") as batch:
            batch.add_column(sa.Column("priority", sa.Integer(), nullable=True))

    rows = bind.execute(sa.text(
        "SELECT id, user_id, deadline, created_at FROM savings_goals WHERE priority IS NULL"
    )).fetchall()
    by_user: dict[int, list] = {}
    for row in rows:
        by_user.setdefault(row.user_id, []).append(row)
    for user_id, goals in by_user.items():
        start = bind.execute(
            sa.text("SELECT COALESCE(MAX(priority), 0) FROM savings_goals WHERE user_id = :user_id"),
            {"user_id": user_id},
        ).scalar() or 0
        goals.sort(key=lambda g: (g.deadline is None, str(g.deadline or ""), str(g.created_at or ""), g.id))
        for offset, goal in enumerate(goals, start=1):
            bind.execute(
                sa.text("UPDATE savings_goals SET priority = :priority WHERE id = :id"),
                {"priority": start + offset, "id": goal.id},
            )


def downgrade() -> None:
    if "priority" in _columns(op.get_bind()):
        with op.batch_alter_table("savings_goals") as batch:
            batch.drop_column("priority")
