"""A Transfer category for every user who has none.

Revision ID: 20261110_000030
Revises: 20261110_000029

Data only: the `categories.type` column already holds free text, and the API
now accepts `transfer` alongside income, expense and investment. New users get
the category from the signup seed; this gives existing users the same one.

Idempotent: a user who already has a transfer-type category is left alone.
Downgrade removes only the rows this revision added (system rows named
"Transfer"), after detaching any transaction filed under them so no row
points at a missing category.
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20261110_000030"
down_revision = "20261110_000029"
branch_labels = None
depends_on = None

NAME = "Transfer"
COLOR = "#7880a0"


def upgrade() -> None:
    bind = op.get_bind()
    users = [row[0] for row in bind.execute(sa.text("SELECT id FROM users")).fetchall()]
    have = {
        row[0]
        for row in bind.execute(
            sa.text("SELECT DISTINCT user_id FROM categories WHERE type = 'transfer' AND user_id IS NOT NULL")
        ).fetchall()
    }
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for user_id in users:
        if user_id in have:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO categories (user_id, name, type, color, is_system, created_at, updated_at) "
                "VALUES (:user_id, :name, 'transfer', :color, :is_system, :now, :now)"
            ),
            {"user_id": user_id, "name": NAME, "color": COLOR, "is_system": True, "now": now},
        )


def downgrade() -> None:
    bind = op.get_bind()
    ids = [
        row[0]
        for row in bind.execute(
            sa.text("SELECT id FROM categories WHERE type = 'transfer' AND name = :name AND is_system = :yes"),
            {"name": NAME, "yes": True},
        ).fetchall()
    ]
    for category_id in ids:
        bind.execute(sa.text("UPDATE transactions SET category_id = NULL WHERE category_id = :id"), {"id": category_id})
        bind.execute(sa.text("DELETE FROM categories WHERE id = :id"), {"id": category_id})
