"""Baseline schema for Fintrack.

Revision ID: 20260612_000001
Revises:
Create Date: 2026-06-12 00:00:01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260612_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("balance", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("credit_limit", sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("plaid_account_id", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plaid_account_id"),
    )
    op.create_index(op.f("ix_accounts_id"), "accounts", ["id"], unique=False)

    op.create_table(
        "assets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("asset_class", sa.String(length=20), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=15, scale=4), nullable=True),
        sa.Column("value_per_unit", sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column("total_value", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_assets_id"), "assets", ["id"], unique=False)

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_categories_id"), "categories", ["id"], unique=False)

    op.create_table(
        "loans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("borrower_name", sa.String(length=100), nullable=False),
        sa.Column("amount", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("amount_repaid", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("loan_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_loans_id"), "loans", ["id"], unique=False)

    op.create_table(
        "plaid_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("item_id", sa.String(length=200), nullable=False),
        sa.Column("institution_name", sa.String(length=200), nullable=True),
        sa.Column("cursor", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id"),
    )
    op.create_index(op.f("ix_plaid_items_id"), "plaid_items", ["id"], unique=False)

    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(), nullable=False),
        sa.Column("p256dh", sa.String(), nullable=False),
        sa.Column("auth", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index(op.f("ix_push_subscriptions_id"), "push_subscriptions", ["id"], unique=False)
    op.create_index(op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"], unique=False)

    op.create_table(
        "recurring_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("next_date", sa.Date(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("is_variable", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_recurring_transactions_id"), "recurring_transactions", ["id"], unique=False)

    op.create_table(
        "savings_goals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("target_amount", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_savings_goals_id"), "savings_goals", ["id"], unique=False)

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("plaid_tx_id", sa.String(length=200), nullable=True),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plaid_tx_id"),
    )
    op.create_index(op.f("ix_transactions_id"), "transactions", ["id"], unique=False)

    op.create_table(
        "transfers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("from_account_id", sa.Integer(), nullable=False),
        sa.Column("to_account_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("transfer_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["from_account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_transfers_id"), "transfers", ["id"], unique=False)

    op.create_table(
        "savings_goal_allocations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["goal_id"], ["savings_goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_savings_goal_allocations_id"), "savings_goal_allocations", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_savings_goal_allocations_id"), table_name="savings_goal_allocations")
    op.drop_table("savings_goal_allocations")
    op.drop_index(op.f("ix_transfers_id"), table_name="transfers")
    op.drop_table("transfers")
    op.drop_index(op.f("ix_transactions_id"), table_name="transactions")
    op.drop_table("transactions")
    op.drop_index(op.f("ix_savings_goals_id"), table_name="savings_goals")
    op.drop_table("savings_goals")
    op.drop_index(op.f("ix_recurring_transactions_id"), table_name="recurring_transactions")
    op.drop_table("recurring_transactions")
    op.drop_index(op.f("ix_push_subscriptions_user_id"), table_name="push_subscriptions")
    op.drop_index(op.f("ix_push_subscriptions_id"), table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_index(op.f("ix_plaid_items_id"), table_name="plaid_items")
    op.drop_table("plaid_items")
    op.drop_index(op.f("ix_loans_id"), table_name="loans")
    op.drop_table("loans")
    op.drop_index(op.f("ix_categories_id"), table_name="categories")
    op.drop_table("categories")
    op.drop_index(op.f("ix_assets_id"), table_name="assets")
    op.drop_table("assets")
    op.drop_index(op.f("ix_accounts_id"), table_name="accounts")
    op.drop_table("accounts")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
