"""Tenant isolation beyond the request path: cron, jobs, push, assistant tools.

`test_tenant_isolation.py` proves the HTTP routes. This file proves the paths
that run *without* a signed-in user — the nightly cron endpoints, the job
dispatcher, push delivery — still touch each user's rows and devices only,
and that every assistant read tool sees exactly one tenant's ledger.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.auth import User
from models.database import (
    Account,
    AccountBalanceSnapshot,
    Asset,
    Category,
    Loan,
    RecurringTransaction,
    SavingsGoal,
    SavingsGoalAllocation,
    Transaction,
)
from models.push import PushSubscription
from routers import assistant
from services import jobs
from utils import auth as auth_utils
from utils import push_sender

CRON = {"X-Cron-Secret": "cron-secret"}


def _user(db, tag: str, tz: str = "UTC") -> User:
    row = User(
        email=f"{tag}@example.com", username=tag,
        hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True, timezone=tz,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _ledger(db, owner: User, marker: str, *, bill_due: date) -> dict:
    account = Account(user_id=owner.id, name=f"{marker} checking", type="checking", balance=Decimal("1000.00"))
    category = Category(user_id=owner.id, name=f"{marker} cat", type="expense", color="#111111")
    db.add_all([account, category])
    db.flush()
    db.add(Transaction(
        user_id=owner.id, account_id=account.id, category_id=category.id, amount=Decimal("-10.00"),
        description=f"{marker} lunch", transaction_date=date.today() - timedelta(days=3),
    ))
    bill = RecurringTransaction(
        user_id=owner.id, account_id=account.id, category_id=category.id, amount=Decimal("-25.00"),
        description=f"{marker} bill", period="monthly", next_date=bill_due, is_active=True, is_variable=False,
    )
    goal = SavingsGoal(user_id=owner.id, name=f"{marker} goal", target_amount=Decimal("300.00"))
    db.add_all([
        bill, goal,
        Asset(user_id=owner.id, name=f"{marker} asset", type="gold", total_value=Decimal("50.00")),
        Loan(user_id=owner.id, borrower_name=f"{marker} friend", amount=Decimal("40.00"), loan_date=date.today()),
        PushSubscription(user_id=owner.id, endpoint=f"https://push.example.com/{marker}", p256dh="k", auth="a"),
    ])
    db.flush()
    db.add(SavingsGoalAllocation(user_id=owner.id, goal_id=goal.id, account_id=account.id, amount=Decimal("20.00")))
    db.commit()
    return {"account": account, "bill": bill}


@pytest.fixture
def two_tenants(db_session, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "cron-secret")
    alice = _user(db_session, "alice", "America/New_York")
    bob = _user(db_session, "bob", "Asia/Tokyo")
    a = _ledger(db_session, alice, "ALICE", bill_due=date.today())
    b = _ledger(db_session, bob, "BOB", bill_due=date.today() + timedelta(days=10))  # not due
    return alice, bob, a, b


# ─── Cron: recurring posting ──────────────────────────────────────────────────
def test_cron_posts_only_the_due_users_bill_and_touches_only_their_balance(client, db_session, two_tenants):
    alice, bob, a, b = two_tenants

    response = client.post("/cron/process-recurring", headers=CRON)

    assert response.status_code == 200
    db_session.expire_all()
    alice_rows = db_session.query(Transaction).filter(Transaction.user_id == alice.id).all()
    bob_rows = db_session.query(Transaction).filter(Transaction.user_id == bob.id).all()
    assert any(t.description == "ALICE bill" for t in alice_rows)
    assert all(t.description != "BOB bill" for t in bob_rows)
    assert all(t.user_id == alice.id for t in alice_rows)
    assert Decimal(str(db_session.get(Account, a["account"].id).balance)) == Decimal("975.00")
    assert Decimal(str(db_session.get(Account, b["account"].id).balance)) == Decimal("1000.00")


# ─── Cron: snapshots ──────────────────────────────────────────────────────────
def test_snapshots_are_written_per_user_and_never_cross(client, db_session, two_tenants):
    alice, bob, a, b = two_tenants

    response = client.post("/cron/refresh-balance-snapshots", headers=CRON)

    assert response.status_code == 200
    assert response.json()["refreshed"] == 2
    rows = db_session.query(AccountBalanceSnapshot).all()
    by_user = {}
    for row in rows:
        by_user.setdefault(row.user_id, set()).add(row.account_id)
    assert by_user[alice.id] == {a["account"].id}
    assert by_user[bob.id] == {b["account"].id}


# ─── Jobs ─────────────────────────────────────────────────────────────────────
def test_job_dispatcher_handles_each_user_only_with_their_own_id(db_session, two_tenants):
    alice, bob, _, _ = two_tenants
    seen: list[tuple[int, str]] = []

    def handler(session, payload):
        owner = session.get(User, payload["user_id"])
        names = sorted(a.name for a in session.query(Account).filter(Account.user_id == owner.id))
        seen.append((owner.id, ",".join(names)))

    jobs.register("test.per_user", handler)
    for owner in (alice, bob):
        jobs.enqueue(db_session, "test.per_user", {"user_id": owner.id})
    result = jobs.dispatch(db_session)

    assert result["succeeded"] == 2
    assert sorted(seen) == [(alice.id, "ALICE checking"), (bob.id, "BOB checking")]


# ─── Push ─────────────────────────────────────────────────────────────────────
def test_push_goes_only_to_the_addressed_users_devices(db_session, two_tenants, monkeypatch):
    alice, bob, _, _ = two_tenants
    delivered: list[str] = []

    class FakeWebPushException(Exception):
        response = None

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims):
        delivered.append(subscription_info["endpoint"])

    monkeypatch.setattr(push_sender, "VAPID_PRIVATE_KEY", "test-key")
    monkeypatch.setitem(
        __import__("sys").modules, "pywebpush",
        type("M", (), {"webpush": staticmethod(fake_webpush), "WebPushException": FakeWebPushException}),
    )

    push_sender.send_push_to_user(db_session, alice.id, "Hi", "Alice only")

    assert delivered == ["https://push.example.com/ALICE"]


def test_cron_alerts_reach_only_the_user_they_concern(client, db_session, two_tenants, monkeypatch):
    alice, bob, a, b = two_tenants
    # Bob's bill is due in 10 days — outside the reminder window. Make Alice's
    # bill due tomorrow so she gets a reminder and Bob gets nothing.
    a["bill"].next_date = date.today() + timedelta(days=1)
    db_session.commit()
    sent: list[tuple[int, str]] = []
    monkeypatch.setattr("routers.cron.send_push_to_user", lambda db, uid, title, body, **kw: sent.append((uid, title)))

    client.post("/cron/process-recurring", headers=CRON)

    assert sent and all(uid == alice.id for uid, _ in sent)
    assert any("ALICE bill" in title for _, title in sent)


# ─── Assistant tools ──────────────────────────────────────────────────────────
REQUIRED_TOOL_ARGS = {
    "affordability_check": {"amount": 10},
    "simulate_scenario": {"monthly_contribution": 1, "months": 1},
}


def test_every_assistant_read_tool_sees_one_tenant_only(db_session, two_tenants):
    alice, bob, _, _ = two_tenants
    for name, tool in assistant.READ_TOOLS.items():
        result = assistant._dump(tool(db_session, bob, **REQUIRED_TOOL_ARGS.get(name, {})))
        assert "ALICE" not in result, f"{name} leaked another user's data"
        # Sanity: Bob's own data is visible where the tool lists rows.
        if name in {"list_accounts", "list_transactions", "list_recurring", "list_savings_goals", "list_loans", "list_assets"}:
            assert "BOB" in result, f"{name} returned nothing for its own user"


def test_assistant_live_context_is_per_user(db_session, two_tenants):
    alice, bob, _, _ = two_tenants
    context = assistant._live_context_text(db_session, bob)
    assert "BOB checking" in context and "ALICE" not in context
    system = assistant._build_system_blocks(db_session, bob)
    assert all("ALICE" not in block["text"] for block in system)
