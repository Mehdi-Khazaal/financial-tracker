"""Split transactions: validation, attribution, what drops a split, isolation."""

import re
from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Budget, Category, Transaction, TransactionSplit
from routers import assistant, plaid_router
from routers.plaid_router import PlaidItem
from services import budgets as budget_service
from services import splits as split_service
from utils import auth as auth_utils
from utils.dates import user_today
from utils.secret_box import encrypt_secret


@pytest.fixture
def cats(db_session, user):
    rows = {name: Category(user_id=user.id, name=name, type="expense", color="#fff") for name in ("Groceries", "Household", "Pharmacy")}
    db_session.add_all(rows.values())
    db_session.commit()
    return {name: row.id for name, row in rows.items()}


@pytest.fixture
def costco(db_session, user, account):
    tx = Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-100.00"), description="COSTCO", transaction_date=user_today(user))
    db_session.add(tx)
    db_session.commit()
    return tx


def _split(client, headers, tx_id, lines):
    return client.put(f"/transactions/{tx_id}/splits", headers=headers, json={"splits": lines})


# ─── Validation ───────────────────────────────────────────────────────────────
def test_lines_must_add_up_exactly_and_follow_the_sign():
    L = split_service.SplitLine
    ok = split_service.validate(Decimal("-100.00"), [L(1, Decimal("-60")), L(2, Decimal("-40.00"))])
    assert [line.amount for line in ok] == [Decimal("-60.00"), Decimal("-40.00")]
    cases = [
        ([L(1, Decimal("-60")), L(2, Decimal("-39.99"))], "add up to $99.99"),
        ([L(1, Decimal("-110")), L(2, Decimal("10"))], "same way"),
        ([L(1, Decimal("-100"))], "between 2 and 20"),
        ([L(1, Decimal("-50")), L(1, Decimal("-50"))], "once"),
        ([L(1, Decimal("-50.005")), L(2, Decimal("-49.995"))], "two decimal places"),
        ([L(1, Decimal("-100")), L(2, Decimal("0"))], "needs an amount"),
    ]
    for lines, message in cases:
        with pytest.raises(split_service.InvalidSplit, match=re.escape(message)):
            split_service.validate(Decimal("-100.00"), lines)


def test_api_rejects_bad_splits_and_foreign_categories(client, db_session, user, auth_headers, cats, costco):
    bad = _split(client, auth_headers, costco.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-30"}])
    assert bad.status_code == 422 and "add up to $90.00" in bad.json()["detail"]

    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    theirs = Category(user_id=other.id, name="Theirs", type="expense", color="#fff")
    db_session.add(theirs)
    db_session.commit()
    res = _split(client, auth_headers, costco.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": theirs.id, "amount": "-40"}])
    assert res.status_code == 404
    assert db_session.query(TransactionSplit).count() == 0


# ─── Storing ──────────────────────────────────────────────────────────────────
def test_split_files_the_parent_under_the_largest_line_and_never_moves_money(client, db_session, user, account, auth_headers, cats, costco):
    balance = Decimal(str(account.balance))
    res = _split(client, auth_headers, costco.id, [
        {"category_id": cats["Household"], "amount": "-40.00", "note": "bin bags"},
        {"category_id": cats["Groceries"], "amount": "-60.00"},
    ])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["category_id"] == cats["Groceries"] and body["category_source"] == "user"
    assert [(s["category_id"], s["amount"], s["note"]) for s in body["splits"]] == [
        (cats["Household"], "-40.00", "bin bags"), (cats["Groceries"], "-60.00", None),
    ]
    db_session.expire_all()
    assert Decimal(str(account.balance)) == balance

    # Replacing is total: the old lines go.
    res = _split(client, auth_headers, costco.id, [
        {"category_id": cats["Pharmacy"], "amount": "-10"}, {"category_id": cats["Groceries"], "amount": "-90"},
    ])
    assert [s["category_id"] for s in res.json()["splits"]] == [cats["Pharmacy"], cats["Groceries"]]
    assert db_session.query(TransactionSplit).count() == 2

    listed = client.get("/transactions/", headers=auth_headers).json()
    assert len(listed[0]["splits"]) == 2

    cleared = client.delete(f"/transactions/{costco.id}/splits", headers=auth_headers)
    assert cleared.status_code == 200 and cleared.json()["splits"] == [] and cleared.json()["category_id"] == cats["Groceries"]


def test_other_users_cannot_split_or_clear(client, db_session, user, auth_headers, cats, costco):
    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    other_headers = {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(other.id)})}"}
    lines = [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-40"}]
    assert _split(client, other_headers, costco.id, lines).status_code == 404
    assert client.delete(f"/transactions/{costco.id}/splits", headers=other_headers).status_code == 404


# ─── Attribution ──────────────────────────────────────────────────────────────
def test_budgets_count_each_line_against_its_own_category(client, db_session, user, auth_headers, cats, costco):
    first = user_today(user).replace(day=1)
    db_session.add_all([
        Budget(user_id=user.id, category_id=cats["Groceries"], amount=Decimal("500"), starts_on=first),
        Budget(user_id=user.id, category_id=cats["Household"], amount=Decimal("50"), starts_on=first),
    ])
    db_session.commit()
    before = client.get("/budgets/progress", headers=auth_headers)
    # Before the split the parent is uncategorised, so neither budget counts it.
    assert {b["category_name"]: b["spent"] for b in before.json()["budgets"]} == {"Groceries": "0.00", "Household": "0.00"}

    _split(client, auth_headers, costco.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-40"}])
    after = client.get("/budgets/progress", headers={**auth_headers, "If-None-Match": before.headers["etag"]})
    assert after.status_code == 200  # the split changed the ETag
    assert {b["category_name"]: b["spent"] for b in after.json()["budgets"]} == {"Groceries": "60.00", "Household": "40.00"}
    progress = budget_service.progress_for_month(db_session, user, first)
    assert sum((p.spent for p in progress), Decimal("0")) == Decimal("100.00")


def test_assistant_category_totals_read_the_lines(client, db_session, user, account, auth_headers, cats, costco):
    db_session.add(Transaction(user_id=user.id, account_id=account.id, category_id=cats["Groceries"], amount=Decimal("-5.00"), description="Bakery", transaction_date=user_today(user)))
    db_session.commit()
    _split(client, auth_headers, costco.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-40"}])
    rows = assistant.READ_TOOLS["spending_by_category"](db_session, user)
    assert {r["category"]: r["total_spent"] for r in rows} == {"Groceries": 65.0, "Household": 40.0}
    listed = assistant.READ_TOOLS["list_transactions"](db_session, user)
    costco_row = next(r for r in listed if r["description"] == "COSTCO")
    assert len(costco_row["split"]) == 2


# ─── What drops a split ───────────────────────────────────────────────────────
def test_editing_the_amount_or_the_category_drops_the_split_but_a_note_does_not(client, db_session, user, account, auth_headers, cats, costco):
    lines = [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-40"}]
    _split(client, auth_headers, costco.id, lines)

    kept = client.put(f"/transactions/{costco.id}", headers=auth_headers, json={"description": "COSTCO #42", "category_id": cats["Groceries"], "amount": "-100.00"})
    assert kept.status_code == 200 and len(kept.json()["splits"]) == 2

    dropped = client.put(f"/transactions/{costco.id}", headers=auth_headers, json={"amount": "-120.00"})
    assert dropped.json()["splits"] == [] and dropped.json()["category_id"] == cats["Groceries"]

    _split(client, auth_headers, costco.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-60"}])
    recategorised = client.put(f"/transactions/{costco.id}", headers=auth_headers, json={"category_id": cats["Pharmacy"]})
    assert recategorised.json()["splits"] == [] and recategorised.json()["category_id"] == cats["Pharmacy"]


def test_deleting_the_transaction_removes_its_lines(client, db_session, user, auth_headers, cats, costco):
    _split(client, auth_headers, costco.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-40"}])
    assert client.delete(f"/transactions/{costco.id}", headers=auth_headers).status_code == 204
    assert db_session.query(TransactionSplit).count() == 0


def test_a_bank_revision_of_the_amount_drops_the_split_and_an_unchanged_one_keeps_it(client, db_session, user, account, auth_headers, cats, monkeypatch):
    account.plaid_account_id = "plaid-acct-1"
    item = PlaidItem(user_id=user.id, access_token=encrypt_secret("t"), item_id="item-1", institution_name="Bank")
    tx = Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-100.00"), description="COSTCO", plaid_tx_id="tx-1", transaction_date=date(2026, 3, 2))
    db_session.add_all([item, tx])
    db_session.commit()
    _split(client, auth_headers, tx.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-40"}])

    def page(amount):
        return {"transaction_id": "tx-1", "account_id": "plaid-acct-1", "amount": amount, "date": "2026-03-02", "name": "COSTCO", "pending": False}

    def run(amount):
        def fake_post(path, body):
            if path == "/accounts/get":
                return {"accounts": [{"account_id": "plaid-acct-1", "balances": {"current": 100.0}, "type": "depository"}]}
            return {"added": [], "modified": [page(amount)], "removed": [], "next_cursor": "c", "has_more": False}
        monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
        plaid_router._sync_item(db_session, item, user.id)
        db_session.expire_all()

    run(100.00)  # same charge re-sent
    assert db_session.query(TransactionSplit).filter_by(transaction_id=tx.id).count() == 2
    run(104.50)  # the bank revised it
    assert db_session.query(TransactionSplit).filter_by(transaction_id=tx.id).count() == 0
    refreshed = db_session.get(Transaction, tx.id)
    assert refreshed.amount == Decimal("-104.50") and refreshed.category_id == cats["Groceries"]


def test_export_includes_the_lines(client, db_session, user, auth_headers, cats, costco):
    _split(client, auth_headers, costco.id, [{"category_id": cats["Groceries"], "amount": "-60"}, {"category_id": cats["Household"], "amount": "-40"}])
    body = client.get("/account/export", headers=auth_headers).json()
    assert [(s["transaction_id"], s["amount"]) for s in body["transaction_splits"]] == [(costco.id, "-60.00"), (costco.id, "-40.00")]
