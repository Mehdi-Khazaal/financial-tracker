"""Two users, full data each, zero cross-visibility on every router.

`test_security_boundaries.py` covers the recurring, cron, assistant and stock
edges. This file is the systematic sweep the audit asked for: every endpoint
that takes an id or references a resource is tried from the *other* user's
session and must answer as if the resource did not exist. List endpoints must
never include the other tenant's rows.

Plaid endpoints are covered too: ownership is checked before any Plaid call,
so `_plaid_post` is patched to fail loudly — reaching Plaid with another
user's token would itself be the bug.
"""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import (
    Account,
    Asset,
    AssistantConversation,
    AssistantMemory,
    Category,
    Loan,
    RecurringTransaction,
    SavingsGoal,
    SavingsGoalAllocation,
    Transaction,
    Transfer,
)
from models.push import PushSubscription
from routers import plaid_router
from routers.plaid_router import PlaidItem
from utils import auth as auth_utils
from utils.secret_box import encrypt_secret


@pytest.fixture
def victim(db_session):
    """A second user with one of everything."""
    owner = User(
        email="victim@example.com",
        username="victim",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
    )
    db_session.add(owner)
    db_session.commit()
    db_session.refresh(owner)

    checking = Account(user_id=owner.id, name="V Checking", type="checking", balance=Decimal("800.00"))
    savings = Account(user_id=owner.id, name="V Savings", type="savings", balance=Decimal("300.00"))
    category = Category(user_id=owner.id, name="V Private", type="expense", color="#112233")
    db_session.add_all([checking, savings, category])
    db_session.flush()

    tx = Transaction(
        user_id=owner.id, account_id=checking.id, category_id=category.id,
        amount=Decimal("-12.00"), description="V lunch", transaction_date=date(2026, 6, 1),
    )
    transfer = Transfer(
        user_id=owner.id, from_account_id=checking.id, to_account_id=savings.id,
        amount=Decimal("50.00"), transfer_date=date(2026, 6, 1),
    )
    asset = Asset(user_id=owner.id, name="V Watch", type="jewellery", total_value=Decimal("900.00"))
    goal = SavingsGoal(user_id=owner.id, name="V Goal", target_amount=Decimal("1000.00"))
    loan = Loan(user_id=owner.id, borrower_name="V Friend", amount=Decimal("100.00"), loan_date=date(2026, 6, 1))
    recurring = RecurringTransaction(
        user_id=owner.id, account_id=checking.id, category_id=category.id,
        amount=Decimal("-9.99"), description="V Netflix", period="monthly", next_date=date(2026, 7, 1),
    )
    conversation = AssistantConversation(user_id=owner.id, title="V chat")
    memory = AssistantMemory(user_id=owner.id, content="V likes gold")
    item = PlaidItem(
        user_id=owner.id, access_token=encrypt_secret("access-sandbox-victim"),
        item_id="victim-item", institution_name="V Bank",
    )
    push_sub = PushSubscription(
        user_id=owner.id, endpoint="https://push.example.com/victim", p256dh="k", auth="a",
    )
    db_session.add_all([tx, transfer, asset, goal, loan, recurring, conversation, memory, item, push_sub])
    db_session.flush()
    db_session.add(SavingsGoalAllocation(user_id=owner.id, goal_id=goal.id, account_id=savings.id, amount=Decimal("100.00")))
    db_session.commit()

    for row in (checking, savings, category, tx, transfer, asset, goal, loan, recurring, conversation, memory, item, push_sub):
        db_session.refresh(row)
    return {
        "user": owner, "checking": checking, "savings": savings, "category": category,
        "transaction": tx, "transfer": transfer, "asset": asset, "goal": goal, "loan": loan,
        "recurring": recurring, "conversation": conversation, "memory": memory, "item": item,
        "push": push_sub,
    }


@pytest.fixture(autouse=True)
def _plaid_must_not_be_called(monkeypatch):
    def boom(path, body):  # pragma: no cover - reaching here is the failure
        raise AssertionError(f"Plaid was called at {path} for another user's item")

    monkeypatch.setattr(plaid_router, "_plaid_post", boom)


# ─── Reads by id ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "path",
    [
        "/accounts/{checking}",
        "/transactions/{transaction}",
        "/transfers/{transfer}",
        "/assets/{asset}",
        "/assistant/conversations/{conversation}",
    ],
)
def test_reading_another_users_resource_is_404(client, auth_headers, victim, path):
    ids = {key: value.id for key, value in victim.items() if hasattr(value, "id")}
    response = client.get(path.format(**ids), headers=auth_headers)
    assert response.status_code == 404, path


def test_account_history_for_another_users_account_is_empty(client, auth_headers, victim):
    response = client.get(f"/history/account/{victim['checking'].id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


# ─── Lists never leak ─────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "path, marker",
    [
        ("/accounts/", "V Checking"),
        ("/transactions/", "V lunch"),
        ("/transfers/", "50.00"),
        ("/categories/", "V Private"),
        ("/assets/", "V Watch"),
        ("/savings-goals/", "V Goal"),
        ("/loans/", "V Friend"),
        ("/recurring/", "V Netflix"),
        ("/recurring/overview", "V Netflix"),
        ("/plaid/items", "V Bank"),
        ("/plaid/sync-status", "V Bank"),
        ("/assistant/conversations", "V chat"),
        ("/assistant/memories", "V likes gold"),
        ("/history/accounts", "V Checking"),
    ],
)
def test_lists_exclude_the_other_tenant(client, auth_headers, victim, path, marker):
    response = client.get(path, headers=auth_headers)
    assert response.status_code == 200, (path, response.text)
    assert marker not in response.text, path


# ─── Writes by id ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "method, path, body",
    [
        ("put", "/accounts/{checking}", {"name": "Hijacked"}),
        ("delete", "/accounts/{checking}", None),
        ("put", "/transactions/{transaction}", {"description": "Hijacked"}),
        ("delete", "/transactions/{transaction}", None),
        ("delete", "/transfers/{transfer}", None),
        ("put", "/categories/{category}", {"name": "Hijacked"}),
        ("delete", "/categories/{category}", None),
        ("put", "/assets/{asset}", {"name": "Hijacked"}),
        ("delete", "/assets/{asset}", None),
        ("put", "/savings-goals/{goal}", {"name": "Hijacked"}),
        ("put", "/savings-goals/{goal}/allocations", {"allocations": []}),
        ("post", "/savings-goals/{goal}/spend", {"account_id": 1, "amount": "1.00", "transaction_date": "2026-06-02"}),
        ("delete", "/savings-goals/{goal}", None),
        ("patch", "/loans/{loan}", {"amount_repaid": "100.00"}),
        ("delete", "/loans/{loan}", None),
        ("patch", "/recurring/{recurring}", {"description": "Hijacked"}),
        ("delete", "/recurring/{recurring}", None),
        ("post", "/recurring/{recurring}/log", {"amount": "-5.00"}),
        ("delete", "/assistant/conversations/{conversation}", None),
        ("delete", "/assistant/memories/{memory}", None),
        ("delete", "/plaid/items/{item}", None),
        ("post", "/plaid/items/{item}/remove-local", None),
        ("post", "/plaid/link-token/update/{item}", None),
    ],
)
def test_writing_another_users_resource_is_404_and_changes_nothing(
    client, db_session, auth_headers, victim, method, path, body
):
    ids = {key: value.id for key, value in victim.items() if hasattr(value, "id")}
    url = path.format(**ids)
    response = getattr(client, method)(url, headers=auth_headers, json=body) if body is not None else getattr(client, method)(url, headers=auth_headers)
    assert response.status_code == 404, (method, url, response.text)

    db_session.expire_all()
    assert db_session.get(Account, victim["checking"].id).name == "V Checking"
    assert Decimal(str(db_session.get(Account, victim["checking"].id).balance)) == Decimal("800.00")
    assert db_session.get(Transaction, victim["transaction"].id).description == "V lunch"
    assert db_session.get(Transfer, victim["transfer"].id) is not None
    assert db_session.get(Category, victim["category"].id).name == "V Private"
    assert db_session.get(Asset, victim["asset"].id).name == "V Watch"
    assert db_session.get(SavingsGoal, victim["goal"].id).name == "V Goal"
    assert db_session.query(SavingsGoalAllocation).filter_by(goal_id=victim["goal"].id).count() == 1
    assert db_session.get(Loan, victim["loan"].id).status == "active"
    assert db_session.get(RecurringTransaction, victim["recurring"].id).description == "V Netflix"
    assert db_session.get(AssistantConversation, victim["conversation"].id) is not None
    assert db_session.get(AssistantMemory, victim["memory"].id) is not None
    assert db_session.get(PlaidItem, victim["item"].id) is not None


# ─── References to another user's rows inside a body ──────────────────────────
def test_transfer_between_another_users_accounts_is_rejected(client, db_session, auth_headers, account, victim):
    for payload in (
        {"from_account_id": victim["checking"].id, "to_account_id": account.id},
        {"from_account_id": account.id, "to_account_id": victim["savings"].id},
    ):
        response = client.post(
            "/transfers/", headers=auth_headers,
            json={**payload, "amount": "10.00", "transfer_date": "2026-06-02"},
        )
        assert response.status_code == 404, response.text

    db_session.expire_all()
    assert Decimal(str(db_session.get(Account, victim["checking"].id).balance)) == Decimal("800.00")
    assert Decimal(str(db_session.get(Account, victim["savings"].id).balance)) == Decimal("300.00")
    assert Decimal(str(db_session.get(Account, account.id).balance)) == Decimal("1000.00")
    assert db_session.query(Transfer).count() == 1  # the victim's own


def test_transaction_on_another_users_account_or_category_is_rejected(client, db_session, auth_headers, account, victim):
    for payload in (
        {"account_id": victim["checking"].id, "category_id": None},
        {"account_id": account.id, "category_id": victim["category"].id},
    ):
        response = client.post(
            "/transactions/", headers=auth_headers,
            json={**payload, "amount": "-5.00", "description": "x", "transaction_date": "2026-06-02"},
        )
        assert response.status_code == 404, response.text
    db_session.expire_all()
    assert db_session.query(Transaction).count() == 1


def test_allocation_to_another_users_account_is_rejected(client, db_session, auth_headers, user, victim):
    goal = SavingsGoal(user_id=user.id, name="Mine", target_amount=Decimal("50.00"))
    db_session.add(goal)
    db_session.commit()

    response = client.put(
        f"/savings-goals/{goal.id}/allocations", headers=auth_headers,
        json={"allocations": [{"account_id": victim["savings"].id, "amount": "10.00"}]},
    )
    assert response.status_code == 404
    assert db_session.query(SavingsGoalAllocation).filter_by(goal_id=goal.id).count() == 0


def test_transactions_list_filters_cannot_reach_another_users_account(client, auth_headers, victim):
    response = client.get(f"/transactions/?account_id={victim['checking'].id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_push_unsubscribe_cannot_remove_another_users_subscription(client, db_session, auth_headers, victim):
    response = client.post("/push/unsubscribe", headers=auth_headers, json={"endpoint": victim["push"].endpoint})
    assert response.status_code == 204
    assert db_session.query(PushSubscription).filter_by(endpoint=victim["push"].endpoint).count() == 1


def test_admin_routes_need_the_admin_flag(client, auth_headers, victim):
    assert client.get("/admin/users", headers=auth_headers).status_code == 403
    assert client.post(f"/admin/users/{victim['user'].id}/reset-password", headers=auth_headers).status_code == 403


def test_unauthenticated_requests_are_401_everywhere(client, victim):
    for method, path in (
        ("get", "/accounts/"), ("get", "/transactions/"), ("get", "/transfers/"), ("get", "/loans/"),
        ("get", "/assets/"), ("get", "/savings-goals/"), ("get", "/recurring/"), ("get", "/history/net-worth"),
        ("get", "/plaid/items"), ("get", "/assistant/conversations"), ("get", "/preferences"),
        ("post", "/push/subscribe"), ("post", "/plaid/sync"), ("post", "/assistant/chat"),
    ):
        response = client.post(path, json={}) if method == "post" else client.get(path)
        assert response.status_code == 401, (method, path, response.status_code)
