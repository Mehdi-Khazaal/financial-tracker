import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def engine_options(url: str) -> dict:
    """Connection-pool settings sized for a small service behind Neon's pooler.

    Neon closes idle connections and its pooler has a per-project cap, so the
    pool is kept small, recycled before Neon's idle timeout, and every
    connection is pinged before use. A statement timeout guards the whole
    service against one runaway query holding a pooled connection. SQLite
    (tests, local scratch databases) gets none of this — it has no pool to
    tune and rejects the Postgres options.

    Overridable per environment: `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`,
    `DB_POOL_RECYCLE_SECONDS`, `DB_POOL_TIMEOUT_SECONDS`,
    `DB_STATEMENT_TIMEOUT_MS`, `DB_CONNECT_TIMEOUT_SECONDS`.
    """
    if url.startswith("sqlite"):
        return {}
    options: dict = {
        "pool_pre_ping": True,
        "pool_size": _int_env("DB_POOL_SIZE", 5),
        "max_overflow": _int_env("DB_MAX_OVERFLOW", 5),
        "pool_recycle": _int_env("DB_POOL_RECYCLE_SECONDS", 300),
        "pool_timeout": _int_env("DB_POOL_TIMEOUT_SECONDS", 10),
    }
    if url.startswith("postgres"):
        statement_timeout_ms = _int_env("DB_STATEMENT_TIMEOUT_MS", 15_000)
        options["connect_args"] = {
            "connect_timeout": _int_env("DB_CONNECT_TIMEOUT_SECONDS", 10),
            # Applied per session by the driver; psycopg2 passes `options`
            # straight to libpq.
            "options": f"-c statement_timeout={statement_timeout_ms}",
            # Fintrack does its own idle handling; keepalives let a pooled
            # connection survive a NAT/idle window instead of dying silently.
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 3,
        }
    return options


engine = create_engine(DATABASE_URL, **engine_options(DATABASE_URL))


if DATABASE_URL.startswith("sqlite"):
    # SQLite ignores foreign keys unless asked, per connection. Asking makes a
    # local or e2e database cascade and null-out exactly as Postgres does, so
    # deleting an account or a category behaves the same everywhere.
    from sqlalchemy import event as _event

    @_event.listens_for(engine, "connect")
    def _sqlite_foreign_keys(dbapi_connection, _record):  # pragma: no cover - exercised by the e2e backend
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def utc_now() -> datetime:
    """Return naive UTC for existing TIMESTAMP WITHOUT TIME ZONE columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class Account(Base):
    """A place money sits, and the one number the whole app anchors on.

    **`balance` is an absolute current figure, not a sum of the rows we hold.**
    Two authorities write it, and knowing which is which matters:

    * `plaid_router._sync_item` **overwrites** it wholesale from `/accounts/get`
      — the institution's own number, for accounts with a `plaid_account_id`.
    * `LedgerService._adjust_balance` moves it by a delta on every manual
      transaction, transfer, and savings-goal withdrawal.

    Everything historical is derived from it by walking backwards:
    `services.balance_snapshots` computes each month-end as
    `balance − sum(transactions dated later)`. There is no independent record
    of what the balance used to be.

    KNOWN LIMITATION (Phase 6C-6, deliberately not fixed): because of that,
    a correct balance cannot be *reconstructed* after imported transactions are
    deleted. The imported window is `PLAID_DAYS_REQUESTED`, not the account's
    whole life, so summing survivors is not the balance; there is no opening or
    baseline column to start from; and the snapshots inherit the same anchor
    rather than recording an independent past value. `POST /plaid/reset`
    therefore leaves the balance untouched rather than inventing one — see
    `backend/tests/test_plaid_reset.py`
    ::`test_account_balances_are_left_stale_CURRENT_BEHAVIOUR`, which pins it.

    Fixing it needs data, not logic: an `opening_balance` plus a
    `baseline_date`, written at account creation and when Plaid first adopts an
    account, so the balance becomes `opening_balance + sum(transactions after
    baseline_date)` and external-vs-ledger balances stop sharing one column.
    """

    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(String(50), nullable=False)
    balance = Column(Numeric(15, 2), nullable=False, default=0)
    credit_limit = Column(Numeric(15, 2), nullable=True)
    currency = Column(String(3), default="USD")
    plaid_account_id = Column(String(200), nullable=True, unique=True)
    # Set while the balance sits below the user's low-balance threshold, so
    # the alert fires once per dip and re-arms when the balance recovers.
    low_balance_notified_on = Column(Date, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    transactions = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")
    outgoing_transfers = relationship(
        "Transfer",
        foreign_keys="Transfer.from_account_id",
        back_populates="from_account",
        cascade="all, delete-orphan",
    )
    incoming_transfers = relationship(
        "Transfer",
        foreign_keys="Transfer.to_account_id",
        back_populates="to_account",
        cascade="all, delete-orphan",
    )
    savings_goals = relationship("SavingsGoal", back_populates="account")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(100), nullable=False)
    type = Column(String(20), nullable=False)
    color = Column(String(7), default="#5b8fff")
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    transactions = relationship("Transaction", back_populates="category")


class Transaction(Base):
    """A single ledger entry.

    The `plaid_*` columns preserve enrichment that used to be read and thrown
    away during sync. They exist to answer two questions the old schema could
    not: *which merchant is this really* (across every string variant a bank
    might emit), and *does this charge look scheduled*. All are nullable —
    manual entries have none of them, and rows imported before this migration
    have none either.
    """

    __tablename__ = "transactions"
    __table_args__ = (
        # Every merchant lookup is user-scoped: "what has *this user* filed
        # this merchant under before". A composite index serves that directly;
        # a bare index on the key alone would still scan across tenants.
        # The listing query — `WHERE user_id = ? ORDER BY transaction_date DESC`
        # — is the most frequent in the application and had no index that could
        # serve its sort. The merchant indexes below start with `user_id` but
        # carry a different second column, so the database had to read every
        # row for the user and sort them on each request. Ordering by date is
        # what the ledger, the month picker and every analytics range do.
        Index("ix_transactions_user_date", "user_id", "transaction_date"),
        Index("ix_transactions_user_merchant_key", "user_id", "merchant_key"),
        Index("ix_transactions_user_merchant_entity", "user_id", "plaid_merchant_entity_id"),
        # One CSV import is one batch, so it can be undone as a unit.
        Index("ix_transactions_user_import_batch", "user_id", "import_batch_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"))
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(15, 2), nullable=False)
    description = Column(Text)
    plaid_tx_id = Column(String(200), nullable=True, unique=True)
    transaction_date = Column(Date, nullable=False)
    import_batch_id = Column(String(32), nullable=True)

    # ── Merchant identity ────────────────────────────────────────────────────
    # Plaid's stable merchant identifier. When present this *is* the merchant;
    # no string matching is attempted. Null for manual entries and for Plaid
    # rows Plaid did not enrich.
    plaid_merchant_entity_id = Column(String(64), nullable=True)
    # Plaid's cleaned merchant name ("Netflix"). Kept separately from
    # `description` so we can tell an enriched name from a raw bank string —
    # `description` collapses both and the distinction is unrecoverable after.
    plaid_merchant_name = Column(String(200), nullable=True)
    # Plaid's raw `name` field, exactly as the bank sent it. Retained so
    # normalization can be improved and re-run over history without needing to
    # re-fetch from Plaid. Null for manual entries, where `description` is
    # already the original.
    original_description = Column(Text, nullable=True)
    # Fallback identity: the normalized merchant string. Populated at write
    # time by `services.merchants.merchant_key` for *both* ingestion paths.
    merchant_key = Column(String(120), nullable=True)

    # ── Categorization signals ───────────────────────────────────────────────
    # Plaid's taxonomy, kept raw. Never written straight into `category_id` —
    # it is a different vocabulary from the user's own categories and is only
    # consulted through an explicit mapping table.
    personal_finance_category_primary = Column(String(60), nullable=True)
    personal_finance_category_detailed = Column(String(100), nullable=True)
    # How `category_id` came to hold its current value: "user",
    # "merchant_history", "plaid_pfc", or null for uncategorized. Makes an
    # automatic assignment explainable and, critically, lets sync tell an
    # inferred category from one the user chose so it never overwrites a
    # deliberate choice.
    category_source = Column(String(20), nullable=True)

    # ── Recurrence signals ───────────────────────────────────────────────────
    # "online" / "in store" / "other". A subscription is almost never charged
    # in store, so this cheaply separates a monthly membership from a shop the
    # user happens to visit monthly.
    payment_channel = Column(String(20), nullable=True)
    # "direct debit", "bill payment", "ach"… Near-definitive scheduled-payment
    # markers when a bank populates them.
    transaction_code = Column(String(40), nullable=True)
    # When the charge was initiated, as opposed to when it settled. Posted
    # dates slip across weekends and holidays, which adds noise to interval
    # measurement; the authorized date is the stable one for cadence.
    authorized_date = Column(Date, nullable=True)
    # A foreign-currency charge converts to a slightly different amount every
    # cycle. Recording the currency explains an amount that fails a stability
    # check for a reason other than a price change.
    iso_currency_code = Column(String(8), nullable=True)

    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")
    # How the amount is filed when it spans categories. Never moves money —
    # see `services.splits`.
    splits = relationship(
        "TransactionSplit",
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="TransactionSplit.id",
    )


class TransactionSplit(Base):
    """One line of a split transaction: part of the parent's amount, filed
    under one category. Lines always sum to the parent exactly."""

    __tablename__ = "transaction_splits"
    __table_args__ = (
        Index("ix_transaction_splits_user_category", "user_id", "category_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(15, 2), nullable=False)
    note = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=utc_now)

    transaction = relationship("Transaction", back_populates="splits")


class Transfer(Base):
    __tablename__ = "transfers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    from_account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    to_account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    note = Column(Text, nullable=True)
    transfer_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=utc_now)

    from_account = relationship("Account", foreign_keys=[from_account_id], back_populates="outgoing_transfers")
    to_account = relationship("Account", foreign_keys=[to_account_id], back_populates="incoming_transfers")


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(String(50), nullable=False)
    asset_class = Column(String(20), nullable=False, default="physical")
    quantity = Column(Numeric(15, 4), nullable=True)
    value_per_unit = Column(Numeric(15, 2), nullable=True)
    total_value = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(3), default="USD")
    purchase_date = Column(Date, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"))
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(15, 2), nullable=False)
    description = Column(Text, nullable=True)
    period = Column(String(20), nullable=False)
    next_date = Column(Date, nullable=False)
    is_active = Column(Boolean, default=True)
    is_variable = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utc_now)

    # ── Organisation ─────────────────────────────────────────────────────────
    # One of `services.recurring_groups.GROUP_KEYS`. Assigned automatically on
    # create and overwritten only when the user moves the bill, so a deliberate
    # move is never undone by re-classification. Null only on rows that predate
    # this column; readers fall back to deriving it.
    group_key = Column(String(30), nullable=True)
    # "manual" (typed in) or "detected" (confirmed from a suggestion).
    source = Column(String(20), nullable=True)

    # ── Identity, for matching imported bank charges ─────────────────────────
    # The same two-level identity `services.merchants` gives transactions. A
    # bill on a bank-linked account is never posted by the app; it is marked
    # paid when an imported transaction with this identity arrives.
    plaid_merchant_entity_id = Column(String(64), nullable=True)
    merchant_key = Column(String(120), nullable=True)

    # ── Payment history ──────────────────────────────────────────────────────
    last_paid_date = Column(Date, nullable=True)
    last_paid_amount = Column(Numeric(15, 2), nullable=True)
    last_transaction_id = Column(Integer, ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True)
    # The amount before the most recent price change on a fixed bill, and when
    # the change was seen. Null when the price has never moved.
    previous_amount = Column(Numeric(15, 2), nullable=True)
    amount_changed_on = Column(Date, nullable=True)

    # ── Alert bookkeeping ────────────────────────────────────────────────────
    # Each holds the due date an alert was already sent for, so a nightly job
    # can run any number of times and still notify once per cycle.
    reminder_sent_for = Column(Date, nullable=True)
    missed_alert_sent_for = Column(Date, nullable=True)
    price_alert_sent_on = Column(Date, nullable=True)

    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class RecurringDismissal(Base):
    """A detected recurring charge the user said is not a bill.

    Keyed on the same identity detection groups by, so the suggestion never
    comes back — not on the next page load and not after the next bank sync.
    """

    __tablename__ = "recurring_dismissals"
    __table_args__ = (UniqueConstraint("user_id", "identity", name="uq_recurring_dismissals_user_identity"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    identity = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=utc_now)


class Budget(Base):
    """A monthly spending limit for one expense category.

    `amount` is the allowance for each calendar month from `starts_on` (always
    the first of a month) onward. With `rollover` set, the unspent part of a
    month carries into the next — overspending never carries, so a bad month
    cannot poison the following one. Progress is never stored: it is computed
    from the ledger on read (`services.budgets`), so a late import or a
    re-categorised transaction is reflected immediately. `notified_month`
    remembers the last month an over-budget push went out, so it is sent once.
    """

    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("user_id", "category_id", name="uq_budgets_user_category"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    rollover = Column(Boolean, nullable=False, default=False, server_default="false")
    starts_on = Column(Date, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    notified_month = Column(String(7), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    category = relationship("Category")


class CategorizationRule(Base):
    """"When a transaction looks like X, file it under Y" — the user's own words.

    Rules outrank every inference (merchant history, Plaid's category) because
    they are an explicit instruction rather than a guess; they never outrank a
    category the user set on a specific transaction. Matching is on the
    description (case-insensitive substring or a regular expression) or on the
    normalised merchant key. Lower `priority` wins; ties break on id.
    """

    __tablename__ = "categorization_rules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    # "description" or "merchant" (the normalised merchant key).
    field = Column(String(20), nullable=False, default="description")
    # "contains" or "regex".
    match_type = Column(String(20), nullable=False, default="contains")
    pattern = Column(String(200), nullable=False)
    priority = Column(Integer, nullable=False, default=100)
    is_active = Column(Boolean, nullable=False, default=True)
    # How many transactions this rule has filed, for the settings list.
    applied_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    category = relationship("Category")


class Loan(Base):
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    borrower_name = Column(String(100), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    amount_repaid = Column(Numeric(15, 2), nullable=False, default=0)
    note = Column(Text, nullable=True)
    loan_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class SavingsGoal(Base):
    __tablename__ = "savings_goals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    target_amount = Column(Numeric(15, 2), nullable=False)
    deadline = Column(Date, nullable=True)
    # The highest milestone (0, 50, 75, 100 — percent of target) the user has
    # been notified about. A push goes out only when a save *crosses* a
    # milestone, never merely because the goal still sits above one.
    milestone_notified = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    account = relationship("Account", back_populates="savings_goals")
    allocations = relationship("SavingsGoalAllocation", back_populates="goal", cascade="all, delete-orphan")


class SavingsGoalAllocation(Base):
    __tablename__ = "savings_goal_allocations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    goal_id = Column(Integer, ForeignKey("savings_goals.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)

    goal = relationship("SavingsGoal", back_populates="allocations")
    account = relationship("Account")


# ─── AI Assistant ─────────────────────────────────────────────────────────────
class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False, default="New chat")
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    messages = relationship(
        "AssistantMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AssistantMessage.id",
    )


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("assistant_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=utc_now)

    conversation = relationship("AssistantConversation", back_populates="messages")


class AssistantPendingAction(Base):
    """A write the assistant proposed and the user has not yet confirmed.

    Stored rather than held in process memory so a restart, a cold start, or a
    second worker between "propose" and "confirm" does not lose the action.
    The client holds the raw token; only its SHA-256 is stored, so a database
    read cannot be replayed as a confirmation. `consumed_at` makes execution
    exactly-once under concurrent confirms.
    """

    __tablename__ = "assistant_pending_actions"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("assistant_conversations.id", ondelete="CASCADE"), nullable=True)
    tool = Column(String(50), nullable=False)
    input = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=utc_now)
    expires_at = Column(DateTime, nullable=False, index=True)
    consumed_at = Column(DateTime, nullable=True)


class AssistantUsageDaily(Base):
    """One row per user per (their) calendar day: turns and estimated cost.

    Read before every chat turn to enforce the daily caps, and by the admin
    usage view. See `services.assistant_usage`.
    """

    __tablename__ = "assistant_usage_daily"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_assistant_usage_user_day"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    day = Column(Date, nullable=False, index=True)
    turns = Column(Integer, nullable=False, default=0, server_default="0")
    cost_usd = Column(Numeric(12, 6), nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class AssistantMemory(Base):
    """Durable facts the assistant has learned about the user — its persistent notebook."""

    __tablename__ = "assistant_memories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now)


class AccountBalanceSnapshot(Base):
    """Materialized month-end closing balances per account.

    The `/history/net-worth` endpoint used to re-sum every transaction on every
    request in Python — O(months × N) per call, unusable once a user has years
    of history. This table stores one row per (account, month-end) so the
    endpoint becomes an indexed ORDER BY LIMIT scan. Refreshed nightly by the
    cron worker and on-demand via the admin endpoint after bulk imports.

    Deliberately month-granular: daily rows are 30× the volume for no user-
    visible benefit — every chart in the app is monthly. Add a separate table
    if daily granularity is ever needed.
    """

    __tablename__ = "account_balance_snapshots"
    __table_args__ = (
        UniqueConstraint("account_id", "snapshot_date", name="uq_snapshot_account_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    closing_balance = Column(Numeric(15, 2), nullable=False)
    computed_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class MerchantCanonical(Base):
    """One row per canonical merchant name.

    Plaid returns wildly inconsistent merchant strings — "AMZN Mktp US*A12BC",
    "Amazon.com*ABC", "AMAZON MKTP" — which explodes the transaction list and
    makes category auto-fill useless. This table stores the human-facing
    canonical name plus the category this merchant is *usually* filed under.
    """

    __tablename__ = "merchants_canonical"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False, unique=True, index=True)
    default_category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class MerchantAlias(Base):
    """Maps a raw Plaid/user-typed merchant string → canonical merchant."""

    __tablename__ = "merchant_aliases"

    id = Column(Integer, primary_key=True, index=True)
    raw_name = Column(String(200), nullable=False, unique=True, index=True)
    canonical_id = Column(Integer, ForeignKey("merchants_canonical.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=utc_now)

    canonical = relationship("MerchantCanonical")


class IdempotencyKey(Base):
    """Stores request/response fingerprints so retried writes are safe.

    The client picks a UUID for each mutation and sends it as
    `Idempotency-Key`. The middleware records the response the first time and
    replays it on any repeat within `expires_at`. If the client resends the
    same key with a *different* body we return 409 — that signals the client
    generated a fresh operation but forgot to rotate the key.
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_idempotency_user_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(80), nullable=False, index=True)
    method = Column(String(10), nullable=False)
    path = Column(String(300), nullable=False)
    request_hash = Column(String(64), nullable=False)
    response_status = Column(Integer, nullable=False)
    response_body = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=utc_now)
    expires_at = Column(DateTime, nullable=False, index=True)


class Job(Base):
    """Postgres-backed background job.

    Chosen over Redis / RQ / Celery because the app already depends on
    Postgres and a single-writer worker is enough for the volume — nightly
    Plaid refresh, snapshot rollup, weekly digest emails. Rows go through
    pending → running → done|failed|dead; retries use exponential backoff
    and cap at `MAX_TRIES` after which the job is marked dead for manual
    review instead of looping forever.
    """

    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(80), nullable=False, index=True)
    payload = Column(Text, nullable=False, default="{}")
    run_at = Column(DateTime, nullable=False, default=utc_now, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    tries = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class UserPreferences(Base):
    """Per-user settings for behaviour the user is allowed to change.

    Deliberately its own table rather than columns on `users`. `users` is the
    authentication model, loaded on every request by `get_current_user`, and
    preferences are product state that will grow; keeping them apart also means
    `create_all` provisions this table on startup with no `ALTER TABLE` against
    a live table and no backfill.

    **A missing row means every default**, which is the whole backward-
    compatibility story: no migration has to write anything for existing users,
    and no deployment can silently turn a behaviour off. Rows are created
    lazily, the first time someone actually changes something.

    Nothing here is a secret or a credential, and nothing here may be edited by
    an admin on another user's behalf — see `routers/preferences.py`.
    """

    __tablename__ = "user_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    # Whether Fintrack may choose a category when the user did not. The global
    # `AUTO_CATEGORIZE` environment switch outranks this: effective behaviour is
    # `global AND user`, so turning the environment switch off cannot be
    # overridden here. See `services.user_preferences`.
    automatic_categorization_enabled = Column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    # ── Alerts ──────────────────────────────────────────────────────────────
    # Each switch gates a push the server would otherwise send. Bill reminders
    # and budget alerts default on because that is what shipped; low-balance
    # is new and defaults off so deploying it changes nothing for anyone.
    bill_reminders_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    budget_alerts_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    low_balance_alerts_enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    low_balance_threshold = Column(Numeric(15, 2), nullable=False, default=100, server_default="100")
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
