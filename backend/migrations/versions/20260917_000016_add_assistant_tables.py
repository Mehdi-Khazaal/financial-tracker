"""Bring the assistant's conversation tables under Alembic.

Revision ID: 20260917_000016
Revises: 20260917_000015

`assistant_conversations`, `assistant_messages` and `assistant_memories`
were only ever created by `create_all()` at boot, so a database built from
the migration chain alone lacked them — which Postgres notices the moment a
later revision adds a foreign key to one. Every deployment that has run the
app already has these tables (the boot path created them), so each create
is guarded; on such a database this revision is a no-op. Downgrade drops
them only if they exist.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000016"
down_revision = "20260917_000015"
branch_labels = None
depends_on = None


def _tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    present = _tables(op.get_bind())

    if "assistant_conversations" not in present:
        op.create_table(
            "assistant_conversations",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(200), nullable=False, server_default="New chat"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_assistant_conversations_id", "assistant_conversations", ["id"])
        op.create_index("ix_assistant_conversations_user_id", "assistant_conversations", ["user_id"])

    if "assistant_messages" not in present:
        op.create_table(
            "assistant_messages",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("role", sa.String(20), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["conversation_id"], ["assistant_conversations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_assistant_messages_id", "assistant_messages", ["id"])
        op.create_index("ix_assistant_messages_conversation_id", "assistant_messages", ["conversation_id"])

    if "assistant_memories" not in present:
        op.create_table(
            "assistant_memories",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_assistant_memories_id", "assistant_memories", ["id"])
        op.create_index("ix_assistant_memories_user_id", "assistant_memories", ["user_id"])


def downgrade() -> None:
    present = _tables(op.get_bind())
    for table in ("assistant_messages", "assistant_memories", "assistant_conversations"):
        if table in present:
            op.drop_table(table)
