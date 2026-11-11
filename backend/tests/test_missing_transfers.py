"""Bringing back deleted card payments and transfers, as Transfers.

The live ledger had no card payments and no moves between its own accounts:
the owner deleted them because a transfer used to count as spending on one
side and income on the other. Every account's history walked back wrong as a
result (checking at −$14k in May, a paid-off card "owing" $1,444 less).

These tests pin the preview (read-only, transfer-like rows only) and the
restore (bank-verified, filed as Transfer, balances untouched).
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.database import Account, Category, Transaction
from routers import plaid_router
from routers.plaid_router import PlaidItem, PlaidMutationDuringPagination
from services.classification import classify, load_lookups
from utils.dates import user_today
from utils.secret_box import encrypt_secret


@pytest.fixture
def months(user):
    today = user_today(user)
    this_month = today.replace(day=1)
    last_month = (this_month - timedelta(days=1)).replace(day=1)
    two_ago = (last_month - timedelta(days=1)).replace(day=1)
    return today, last_month, two_ago


@pytest.fixture
def bank(db_session, user, account):
    """A checking account and a card at one bank; the card owes $50 today."""
    account.plaid_account_id = "chk"
    card = Account(user_id=user.id, name="VentureOne", type="credit_card", balance=Decimal("-50"),
                   credit_limit=Decimal("2750"), currency="USD", plaid_account_id="card")
    item = PlaidItem(user_id=user.id, access_token=encrypt_secret("token"), item_id="item-cap", institution_name="Capital One")
    db_session.add_all([card, item])
    db_session.commit()
    return account, card, item


def _tx(tx_id, account_id, amount, on, name, category=None, **extra):
    """A Plaid transaction. Plaid's sign: positive is money out."""
    return {
        "transaction_id": tx_id, "account_id": account_id, "amount": amount, "date": on.isoformat(),
        "name": name, "merchant_name": None, "pending": False,
        "personal_finance_category": {"primary": category, "detailed": None} if category else None,
        **extra,
    }


@pytest.fixture
def history(db_session, user, bank, months):
    """What the banks hold, against what the ledger kept after the deletions."""
    checking, card, _ = bank
    _, last_month, two_ago = months
    charge_on = two_ago + timedelta(days=9)
    pay_on = last_month + timedelta(days=4)
    db_session.add(Transaction(user_id=user.id, account_id=card.id, amount=Decimal("-250"), description="Turkish Airlines",
                               plaid_tx_id="kept-charge", transaction_date=charge_on))
    db_session.commit()
    return [
        _tx("kept-charge", "card", 250, charge_on, "Turkish Airlines", "TRAVEL"),
        _tx("pay-checking", "chk", 200, pay_on, "CAPITAL ONE ONLINE PMT", "LOAN_PAYMENTS"),
        _tx("pay-card", "card", -200, pay_on, "PAYMENT - THANK YOU"),
        _tx("move-out", "chk", 300, pay_on + timedelta(days=3), "ONLINE TRANSFER TO SAVINGS", "TRANSFER_OUT"),
        _tx("coffee", "chk", 4.5, pay_on, "Branch Street Coffee", "FOOD_AND_DRINK"),
        _tx("pending-move", "chk", 50, pay_on, "TRANSFER", "TRANSFER_OUT", pending=True),
        _tx("other-bank", "unknown", 75, pay_on, "TRANSFER", "TRANSFER_OUT"),
    ]


def _serve(monkeypatch, pages_by_token=None, pages=None, fail_for=()):
    calls = []

    def fake_post(path, body):
        calls.append((path, body))
        assert path == "/transactions/sync", path
        if body["access_token"] in fail_for:
            from fastapi import HTTPException
            raise HTTPException(status_code=502, detail="Plaid returned an error")
        added = (pages_by_token or {}).get(body["access_token"], pages or [])
        return {"added": added, "modified": [], "removed": [], "next_cursor": "end", "has_more": False}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return calls


def test_the_preview_offers_only_missing_transfer_like_rows_newest_first(client, auth_headers, db_session, bank, history, monkeypatch):
    calls = _serve(monkeypatch, pages=history)

    body = client.get("/plaid/missing-transfers", headers=auth_headers).json()

    assert [r["plaid_transaction_id"] for r in body["rows"]] == ["move-out", "pay-checking", "pay-card"]
    by_id = {r["plaid_transaction_id"]: r for r in body["rows"]}
    assert Decimal(by_id["pay-checking"]["amount"]) == Decimal("-200")
    assert Decimal(by_id["pay-card"]["amount"]) == Decimal("200")
    assert by_id["pay-card"]["account_name"] == "VentureOne"
    assert body["unavailable"] == []
    # From the beginning of history, and read-only.
    assert "cursor" not in calls[0][1]
    assert bank[2].cursor is None
    assert db_session.query(Transaction).count() == 1


def test_restoring_files_the_chosen_rows_as_transfers_and_leaves_balances_alone(
    client, auth_headers, db_session, user, bank, history, months, monkeypatch,
):
    checking, card, _ = bank
    _, last_month, two_ago = months
    _serve(monkeypatch, pages=history)
    month = lambda d: d.strftime("%Y-%m")  # noqa: E731

    before = {p["month"]: Decimal(p["balance"]) for p in client.get(f"/history/account/{card.id}?months=4", headers=auth_headers).json()}
    restored = client.post("/plaid/missing-transfers/restore", json={"ids": ["pay-checking", "pay-card"]}, headers=auth_headers)

    assert restored.status_code == 200, restored.text
    assert restored.json() == {"restored": 2}
    rows = db_session.query(Transaction).filter(Transaction.plaid_tx_id.in_(["pay-checking", "pay-card"])).all()
    lookups = load_lookups(db_session, user.id)
    assert {classify(r, lookups) for r in rows} == {"transfer"}
    assert {db_session.get(Category, r.category_id).type for r in rows} == {"transfer"}
    db_session.refresh(card)
    db_session.refresh(checking)
    assert card.balance == Decimal("-50")
    assert checking.balance == Decimal("1000")

    after = {p["month"]: Decimal(p["balance"]) for p in client.get(f"/history/account/{card.id}?months=4", headers=auth_headers).json()}
    # Without the payment the card walked back into a $200 credit before the
    # charge. With it, it owed $250 after the charge and nothing before.
    before_charge = month(two_ago - timedelta(days=1))
    assert before[before_charge] == Decimal("200.00")
    assert after[before_charge] == Decimal("0.00")
    assert after[month(two_ago)] == Decimal("-250.00")

    left = client.get("/plaid/missing-transfers", headers=auth_headers).json()["rows"]
    assert [r["plaid_transaction_id"] for r in left] == ["move-out"]


def test_restore_ignores_ids_the_bank_does_not_list_as_missing(client, auth_headers, db_session, bank, history, monkeypatch):
    _serve(monkeypatch, pages=history)

    response = client.post("/plaid/missing-transfers/restore",
                           json={"ids": ["coffee", "kept-charge", "pending-move", "made-up"]}, headers=auth_headers)

    assert response.json() == {"restored": 0}
    assert db_session.query(Transaction).count() == 1


def test_a_bank_that_cannot_be_asked_is_named_and_the_others_still_listed(
    client, auth_headers, db_session, user, bank, history, monkeypatch,
):
    db_session.add(PlaidItem(user_id=user.id, access_token=encrypt_secret("broken"), item_id="item-pnc", institution_name="PNC"))
    db_session.commit()
    _serve(monkeypatch, pages_by_token={"token": history}, fail_for={"broken"})

    body = client.get("/plaid/missing-transfers", headers=auth_headers).json()

    assert body["unavailable"] == ["PNC"]
    assert len(body["rows"]) == 3


def test_a_change_mid_pagination_restarts_from_the_beginning(client, auth_headers, bank, history, monkeypatch):
    attempts = []

    def fake_post(path, body):
        attempts.append(body.get("cursor"))
        if len(attempts) == 2:
            raise PlaidMutationDuringPagination("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")
        if body.get("cursor") == "page-2":
            return {"added": history[3:], "modified": [], "removed": [], "next_cursor": "end", "has_more": False}
        return {"added": history[:3], "modified": [], "removed": [], "next_cursor": "page-2", "has_more": True}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)

    body = client.get("/plaid/missing-transfers", headers=auth_headers).json()

    assert attempts == [None, "page-2", None, "page-2"]
    assert [r["plaid_transaction_id"] for r in body["rows"]] == ["move-out", "pay-checking", "pay-card"]


def test_without_a_connected_bank_there_is_nothing_to_restore(client, auth_headers):
    assert client.get("/plaid/missing-transfers", headers=auth_headers).status_code == 404
    assert client.post("/plaid/missing-transfers/restore", json={"ids": ["x"]}, headers=auth_headers).status_code == 404
