"""Two-factor authentication: TOTP columns on users, recovery codes table.

Revision ID: 20260918_000025
Revises: 20260917_000024

Additive. Every existing user starts with 2FA off (server default false), so
nothing changes for anyone until they enrol. Reversible: dropping these turns
2FA off for everyone and forgets their secrets, which is the safe direction.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260918_000025"
down_revision = "20260917_000024"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    existing = _columns(bind, "users")
    with op.batch_alter_table("users") as batch:
        if "totp_secret" not in existing:
            batch.add_column(sa.Column("totp_secret", sa.Text(), nullable=True))
        if "totp_pending_secret" not in existing:
            batch.add_column(sa.Column("totp_pending_secret", sa.Text(), nullable=True))
        if "totp_enabled" not in existing:
            batch.add_column(sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
        if "totp_last_step" not in existing:
            batch.add_column(sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
    if "recovery_codes" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "recovery_codes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("code_hash", sa.String(64), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_recovery_codes_id", "recovery_codes", ["id"])
        op.create_index("ix_recovery_codes_user_id", "recovery_codes", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "recovery_codes" in sa.inspect(bind).get_table_names():
        op.drop_index("ix_recovery_codes_user_id", table_name="recovery_codes")
        op.drop_index("ix_recovery_codes_id", table_name="recovery_codes")
        op.drop_table("recovery_codes")
    existing = _columns(bind, "users")
    with op.batch_alter_table("users") as batch:
        for name in ("totp_last_step", "totp_enabled", "totp_pending_secret", "totp_secret"):
            if name in existing:
                batch.drop_column(name)
