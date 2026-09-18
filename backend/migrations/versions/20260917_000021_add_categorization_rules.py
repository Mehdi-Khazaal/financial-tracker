"""User categorization rules.

Revision ID: 20260917_000021
Revises: 20260917_000020

New table only. Reversible: dropping it removes the rules, never a
transaction or the category a rule already assigned.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260917_000021"
down_revision = "20260917_000020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "categorization_rules" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "categorization_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("field", sa.String(20), nullable=False, server_default="description"),
        sa.Column("match_type", sa.String(20), nullable=False, server_default="contains"),
        sa.Column("pattern", sa.String(200), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("applied_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_categorization_rules_id", "categorization_rules", ["id"])
    op.create_index("ix_categorization_rules_user_id", "categorization_rules", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "categorization_rules" not in sa.inspect(bind).get_table_names():
        return
    op.drop_index("ix_categorization_rules_user_id", table_name="categorization_rules")
    op.drop_index("ix_categorization_rules_id", table_name="categorization_rules")
    op.drop_table("categorization_rules")
