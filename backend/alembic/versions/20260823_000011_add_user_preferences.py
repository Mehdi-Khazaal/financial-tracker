"""Add user_preferences.

Revision ID: 20260823_000011
Revises: 20260811_000010

Per-user settings for behaviour the user may change, starting with automatic
categorization. A new *table*, which matters for deployment: `create_all()` at
startup provisions missing tables on its own, so unlike the column migrations
in `main.py` this one needs no mirrored `ALTER TABLE ... IF NOT EXISTS`
statement to keep Render working.

Nothing is backfilled, deliberately. A missing row means every default, so
existing users keep exactly the behaviour they have today and no row has to be
written for them. That also makes the downgrade safe: dropping the table
returns everyone to the defaults, which is where they started.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260823_000011"
down_revision = "20260811_000010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "automatic_categorization_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_preferences_user_id"),
    )
    op.create_index(
        "ix_user_preferences_user_id", "user_preferences", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_user_preferences_user_id", table_name="user_preferences")
    op.drop_table("user_preferences")
