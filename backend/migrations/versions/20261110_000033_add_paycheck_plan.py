"""Paycheck plan: paycheck sources, goal lines and per-payday check-offs.

Revision ID: 20261110_000033
Revises: 20261110_000032

New tables only. Dropping them removes the plan and its ticks; money set
aside through a tick stays set aside, because it lives on the goal.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261110_000033"
down_revision = "20261110_000032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "paycheck_plans" not in tables:
        op.create_table(
            "paycheck_plans",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("notify", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("last_notified_payday", sa.Date(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id"),
        )
        op.create_index("ix_paycheck_plans_id", "paycheck_plans", ["id"])
    if "paycheck_sources" not in tables:
        op.create_table(
            "paycheck_sources",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("plan_id", sa.Integer(), nullable=False),
            sa.Column("merchant_key", sa.String(120), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["plan_id"], ["paycheck_plans.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("plan_id", "merchant_key", name="uq_paycheck_source_key"),
        )
        op.create_index("ix_paycheck_sources_id", "paycheck_sources", ["id"])
        op.create_index("ix_paycheck_sources_user_id", "paycheck_sources", ["user_id"])
        op.create_index("ix_paycheck_sources_plan_id", "paycheck_sources", ["plan_id"])
    if "paycheck_lines" not in tables:
        op.create_table(
            "paycheck_lines",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("plan_id", sa.Integer(), nullable=False),
            sa.Column("goal_id", sa.Integer(), nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Numeric(15, 2), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["plan_id"], ["paycheck_plans.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["goal_id"], ["savings_goals.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("plan_id", "goal_id", name="uq_paycheck_line_goal"),
        )
        op.create_index("ix_paycheck_lines_id", "paycheck_lines", ["id"])
        op.create_index("ix_paycheck_lines_user_id", "paycheck_lines", ["user_id"])
        op.create_index("ix_paycheck_lines_plan_id", "paycheck_lines", ["plan_id"])
        op.create_index("ix_paycheck_lines_goal_id", "paycheck_lines", ["goal_id"])
    if "paycheck_checkoffs" not in tables:
        op.create_table(
            "paycheck_checkoffs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("line_id", sa.Integer(), nullable=False),
            sa.Column("payday", sa.Date(), nullable=False),
            sa.Column("amount", sa.Numeric(15, 2), nullable=False),
            sa.Column("set_aside", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("account_id", sa.Integer(), nullable=True),
            sa.Column("done_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["line_id"], ["paycheck_lines.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("line_id", "payday", name="uq_paycheck_checkoff_line_payday"),
        )
        op.create_index("ix_paycheck_checkoffs_id", "paycheck_checkoffs", ["id"])
        op.create_index("ix_paycheck_checkoffs_user_id", "paycheck_checkoffs", ["user_id"])
        op.create_index("ix_paycheck_checkoffs_line_id", "paycheck_checkoffs", ["line_id"])


def downgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    for table, indexes in (
        ("paycheck_checkoffs", ("ix_paycheck_checkoffs_line_id", "ix_paycheck_checkoffs_user_id", "ix_paycheck_checkoffs_id")),
        ("paycheck_lines", ("ix_paycheck_lines_goal_id", "ix_paycheck_lines_plan_id", "ix_paycheck_lines_user_id", "ix_paycheck_lines_id")),
        ("paycheck_sources", ("ix_paycheck_sources_plan_id", "ix_paycheck_sources_user_id", "ix_paycheck_sources_id")),
        ("paycheck_plans", ("ix_paycheck_plans_id",)),
    ):
        if table in tables:
            for index in indexes:
                op.drop_index(index, table_name=table)
            op.drop_table(table)
