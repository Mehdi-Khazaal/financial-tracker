"""Persist the assistant's pending (unconfirmed) actions.

Revision ID: 20260917_000017
Revises: 20260917_000016

Proposed writes used to wait in process memory for the user's confirmation,
so a restart, a cold start or a second worker turned "Confirm" into
"Pending action is invalid or expired". They now live in this table: one
row per proposal, keyed by the SHA-256 of the token the client holds,
consumed exactly once. Expired rows are pruned by the hourly cron.
Reversible: dropping the table only discards proposals not yet confirmed.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000017"
down_revision = "20260917_000016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "assistant_pending_actions" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "assistant_pending_actions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=True),
        sa.Column("tool", sa.String(50), nullable=False),
        sa.Column("input", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["assistant_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assistant_pending_actions_token_hash", "assistant_pending_actions", ["token_hash"], unique=True)
    op.create_index("ix_assistant_pending_actions_user_id", "assistant_pending_actions", ["user_id"])
    op.create_index("ix_assistant_pending_actions_expires_at", "assistant_pending_actions", ["expires_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if "assistant_pending_actions" not in sa.inspect(bind).get_table_names():
        return
    op.drop_index("ix_assistant_pending_actions_expires_at", table_name="assistant_pending_actions")
    op.drop_index("ix_assistant_pending_actions_user_id", table_name="assistant_pending_actions")
    op.drop_index("ix_assistant_pending_actions_token_hash", table_name="assistant_pending_actions")
    op.drop_table("assistant_pending_actions")
