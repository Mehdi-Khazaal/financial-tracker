"""Backfill safety: dry-run writes nothing, apply is idempotent, data is preserved."""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Category, MerchantAlias, Transaction
from scripts.backfill_merchant_identity import main as backfill_main, run_backfill
from services.transaction_enrichment import SOURCE_MERCHANT_HISTORY, SOURCE_USER
from utils import auth as auth_utils


def _add(db_session, user, account, description, *, category=None, day=1, **overrides):
    values = {
        "user_id": user.id,
        "account_id": account.id,
        "category_id": category.id if category else None,
        "amount": Decimal("-9.99"),
        "description": description,
        "transaction_date": date(2026, 1, day),
    }
    values.update(overrides)
    tx = Transaction(**values)
    db_session.add(tx)
    db_session.commit()
    db_session.refresh(tx)
    return tx


# ─── Dry run ──────────────────────────────────────────────────────────────────
def test_dry_run_writes_nothing(db_session, user, account, category):
    tx = _add(db_session, user, account, "NETFLIX.COM")
    report = run_backfill(db_session, dry_run=True)

    assert report.rows_inspected == 1
    assert report.merchant_keys_generated == 1

    db_session.expire_all()
    refreshed = db_session.get(Transaction, tx.id)
    assert refreshed.merchant_key is None
    assert refreshed.category_id is None
    assert db_session.query(MerchantAlias).count() == 0


def test_dry_run_reports_what_apply_would_do(db_session, user, account, category):
    for day in (1, 2):
        _add(db_session, user, account, "NETFLIX", category=category, day=day,
             merchant_key="netflix")
    _add(db_session, user, account, "NETFLIX.COM", day=3)

    dry = run_backfill(db_session, dry_run=True)
    applied = run_backfill(db_session, dry_run=False)

    assert dry.merchant_keys_generated == applied.merchant_keys_generated
    assert dry.categories_suggested == applied.categories_suggested


# ─── Apply ────────────────────────────────────────────────────────────────────
def test_apply_fills_merchant_key(db_session, user, account):
    tx = _add(db_session, user, account, "SQ *COFFEE BAR 998877")
    run_backfill(db_session, dry_run=False)

    db_session.expire_all()
    assert db_session.get(Transaction, tx.id).merchant_key == "coffee bar"


def test_apply_assigns_category_from_confident_history(db_session, user, account, category):
    for day in (1, 2):
        _add(db_session, user, account, "NETFLIX", category=category, day=day,
             merchant_key="netflix")
    target = _add(db_session, user, account, "NETFLIX.COM", day=3)

    report = run_backfill(db_session, dry_run=False)
    assert report.categories_assigned == 1

    db_session.expire_all()
    refreshed = db_session.get(Transaction, target.id)
    assert refreshed.category_id == category.id
    assert refreshed.category_source == SOURCE_MERCHANT_HISTORY


def test_apply_never_overwrites_an_existing_category(db_session, user, account, category):
    other = Category(user_id=user.id, name="Entertainment", type="expense")
    db_session.add(other)
    db_session.commit()

    # Strong history pointing at `other`…
    for day in (1, 2, 3):
        _add(db_session, user, account, "NETFLIX", category=other, day=day, merchant_key="netflix")
    # …but this row is already filed under `category` by the user.
    target = _add(db_session, user, account, "NETFLIX", category=category, day=4,
                  category_source=SOURCE_USER)

    run_backfill(db_session, dry_run=False)

    db_session.expire_all()
    refreshed = db_session.get(Transaction, target.id)
    assert refreshed.category_id == category.id
    assert refreshed.category_source == SOURCE_USER


def test_apply_leaves_ambiguous_rows_uncategorized(db_session, user, account, category):
    other = Category(user_id=user.id, name="Entertainment", type="expense")
    db_session.add(other)
    db_session.commit()
    # A perfect tie — no majority, so no assignment.
    _add(db_session, user, account, "NETFLIX", category=category, day=1, merchant_key="netflix")
    _add(db_session, user, account, "NETFLIX", category=other, day=2, merchant_key="netflix")
    target = _add(db_session, user, account, "NETFLIX", day=3)

    report = run_backfill(db_session, dry_run=False)

    db_session.expire_all()
    assert db_session.get(Transaction, target.id).category_id is None
    assert report.ambiguous_skipped >= 1


def test_apply_does_not_touch_financial_fields(db_session, user, account):
    tx = _add(db_session, user, account, "NETFLIX", plaid_tx_id="plaid-1")
    before = (tx.amount, tx.transaction_date, tx.account_id, tx.plaid_tx_id, tx.user_id)

    run_backfill(db_session, dry_run=False)

    db_session.expire_all()
    after_row = db_session.get(Transaction, tx.id)
    after = (
        after_row.amount, after_row.transaction_date, after_row.account_id,
        after_row.plaid_tx_id, after_row.user_id,
    )
    assert before == after


def test_unresolvable_descriptions_are_skipped_not_keyed(db_session, user, account):
    tx = _add(db_session, user, account, "ACH DEBIT PAYMENT")  # all noise
    report = run_backfill(db_session, dry_run=False)

    db_session.expire_all()
    assert db_session.get(Transaction, tx.id).merchant_key is None
    assert report.unresolvable_skipped == 1


# ─── Idempotency and resumability ─────────────────────────────────────────────
def test_second_run_changes_nothing(db_session, user, account, category):
    for day in (1, 2):
        _add(db_session, user, account, "NETFLIX", category=category, day=day, merchant_key="netflix")
    _add(db_session, user, account, "NETFLIX.COM", day=3)

    first = run_backfill(db_session, dry_run=False)
    second = run_backfill(db_session, dry_run=False)

    assert first.merchant_keys_generated == 1
    assert second.merchant_keys_generated == 0
    assert second.categories_assigned == 0
    assert second.aliases_created == 0


def test_no_duplicate_aliases_across_runs(db_session, user, account):
    _add(db_session, user, account, "STARBUCKS #123", day=1)
    _add(db_session, user, account, "STARBUCKS #123", day=2)

    run_backfill(db_session, dry_run=False)
    run_backfill(db_session, dry_run=False)

    assert db_session.query(MerchantAlias).filter_by(raw_name="STARBUCKS #123").count() == 1


def test_start_id_resumes_without_reprocessing(db_session, user, account):
    first = _add(db_session, user, account, "NETFLIX", day=1)
    second = _add(db_session, user, account, "SPOTIFY", day=2)

    report = run_backfill(db_session, dry_run=False, start_id=first.id)
    assert report.rows_inspected == 1
    assert report.last_id_processed == second.id

    db_session.expire_all()
    assert db_session.get(Transaction, first.id).merchant_key is None
    assert db_session.get(Transaction, second.id).merchant_key == "spotify"


def test_batching_covers_every_row(db_session, user, account):
    for day in range(1, 8):
        _add(db_session, user, account, f"MERCHANT {day} LTD", day=day)

    report = run_backfill(db_session, dry_run=False, batch_size=2)
    assert report.rows_inspected == 7

    db_session.expire_all()
    keyed = db_session.query(Transaction).filter(Transaction.merchant_key.isnot(None)).count()
    assert keyed == 7


def test_no_categories_flag_only_writes_keys(db_session, user, account, category):
    for day in (1, 2):
        _add(db_session, user, account, "NETFLIX", category=category, day=day, merchant_key="netflix")
    target = _add(db_session, user, account, "NETFLIX.COM", day=3)

    report = run_backfill(db_session, dry_run=False, assign_categories=False)
    assert report.categories_assigned == 0

    db_session.expire_all()
    refreshed = db_session.get(Transaction, target.id)
    assert refreshed.merchant_key == "netflix"
    assert refreshed.category_id is None


# ─── Scoping and isolation ────────────────────────────────────────────────────
def test_user_id_scopes_the_run(db_session, user, account):
    other_user = User(
        email="other@example.com", username="other",
        hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True,
    )
    db_session.add(other_user)
    db_session.commit()
    other_account = Account(user_id=other_user.id, name="Theirs", type="checking", balance=0)
    db_session.add(other_account)
    db_session.commit()

    mine = _add(db_session, user, account, "NETFLIX", day=1)
    theirs = _add(db_session, other_user, other_account, "NETFLIX", day=1)

    run_backfill(db_session, dry_run=False, user_id=user.id)

    db_session.expire_all()
    assert db_session.get(Transaction, mine.id).merchant_key == "netflix"
    assert db_session.get(Transaction, theirs.id).merchant_key is None


def test_backfill_does_not_borrow_another_users_categories(db_session, user, account):
    other_user = User(
        email="other2@example.com", username="other2",
        hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True,
    )
    db_session.add(other_user)
    db_session.commit()
    other_account = Account(user_id=other_user.id, name="Theirs", type="checking", balance=0)
    other_category = Category(user_id=other_user.id, name="Streaming", type="expense")
    db_session.add_all([other_account, other_category])
    db_session.commit()

    for day in (1, 2, 3):
        _add(db_session, other_user, other_account, "NETFLIX",
             category=other_category, day=day, merchant_key="netflix")
    mine = _add(db_session, user, account, "NETFLIX", day=4)

    run_backfill(db_session, dry_run=False)

    db_session.expire_all()
    assert db_session.get(Transaction, mine.id).category_id is None


# ─── Production write guard ───────────────────────────────────────────────────
def test_apply_in_production_requires_confirm_flag(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(SystemExit) as excinfo:
        backfill_main(["--apply"])
    assert excinfo.value.code != 0


def test_dry_run_in_production_needs_no_confirmation(monkeypatch, db_session, user, account):
    monkeypatch.setenv("ENVIRONMENT", "production")
    _add(db_session, user, account, "NETFLIX")
    # Must not raise: reading is always allowed.
    assert backfill_main(["--dry-run"]) == 0


def test_apply_outside_production_needs_no_confirmation(monkeypatch, db_session, user, account):
    monkeypatch.setenv("ENVIRONMENT", "test")
    _add(db_session, user, account, "NETFLIX")
    assert backfill_main(["--apply"]) == 0


def test_confirm_production_permits_the_write(monkeypatch, db_session, user, account):
    monkeypatch.setenv("ENVIRONMENT", "production")
    tx = _add(db_session, user, account, "NETFLIX")
    assert backfill_main(["--apply", "--confirm-production"]) == 0
    db_session.expire_all()
    assert db_session.get(Transaction, tx.id).merchant_key == "netflix"


# ─── Reconciliation summary ───────────────────────────────────────────────────
def test_reconciliation_reports_actual_database_state(db_session, user, account, category):
    for day in (1, 2):
        _add(db_session, user, account, "NETFLIX", category=category, day=day, merchant_key="netflix")
    _add(db_session, user, account, "NETFLIX.COM", day=3)
    _add(db_session, user, account, "ACH DEBIT PAYMENT", day=4)  # unresolvable

    report = run_backfill(db_session, dry_run=False)
    summary = report.reconcile(db_session)

    assert "Transactions in scope" in summary
    assert "With a merchant key" in summary
    assert "category_source breakdown" in summary
    # 4 rows, 3 keyable (the all-noise one is not).
    assert "4" in summary


def test_reconciliation_scopes_to_one_user(db_session, user, account):
    from models.auth import User as AuthUser

    other = AuthUser(
        email="recon@example.com", username="recon",
        hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True,
    )
    db_session.add(other)
    db_session.commit()
    other_account = Account(user_id=other.id, name="Theirs", type="checking", balance=0)
    db_session.add(other_account)
    db_session.commit()

    _add(db_session, user, account, "NETFLIX")
    _add(db_session, other, other_account, "SPOTIFY")
    _add(db_session, other, other_account, "HULU")

    report = run_backfill(db_session, dry_run=False, user_id=user.id)

    def scope_count(summary: str) -> int:
        line = next(l for l in summary.splitlines() if "Transactions in scope" in l)
        return int(line.rsplit(maxsplit=1)[1].replace(",", ""))

    # Only this user's single row is in scope; unscoped sees all three.
    assert scope_count(report.reconcile(db_session, user_id=user.id)) == 1
    assert scope_count(report.reconcile(db_session)) == 3
