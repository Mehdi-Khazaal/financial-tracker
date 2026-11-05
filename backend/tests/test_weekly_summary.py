"""The weekly summary push: what it says, when it stays quiet, and that it is weekly."""

from datetime import timedelta
from decimal import Decimal

from models.auth import User
from models.database import Account, Budget, Category, RecurringTransaction, Transaction, TransactionSplit
from models.push import PushSubscription
from routers import cron
from services import user_preferences, weekly_summary
from utils import auth as auth_utils
from utils.dates import user_today


class Recorder:
    def __init__(self):
        self.sent = []

    def __call__(self, db, user_id, title, body, url="/", tag="fintrack"):
        self.sent.append({"user_id": user_id, "title": title, "body": body, "url": url, "tag": tag})


def _category(db, user, name, kind="expense"):
    row = Category(user_id=user.id, name=name, type=kind, color="#5b8fff")
    db.add(row)
    db.commit()
    return row


def _tx(db, user, account, days_ago, amount, category=None, description="Shop"):
    row = Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id if category else None,
        amount=Decimal(str(amount)), description=description,
        transaction_date=user_today(user) - timedelta(days=days_ago),
    )
    db.add(row)
    db.commit()
    return row


def _subscribe(db, user, n=1):
    db.add(PushSubscription(user_id=user.id, endpoint=f"https://push.example/{user.id}/{n}", p256dh="k", auth="a"))
    db.commit()


# ─── What it says ─────────────────────────────────────────────────────────────
def test_counts_the_last_seven_days_the_way_the_app_does(db_session, user, account):
    dining = _category(db_session, user, "Dining")
    groceries = _category(db_session, user, "Groceries")
    gold = _category(db_session, user, "Gold", kind="investment")
    _tx(db_session, user, account, 1, -120, dining)
    _tx(db_session, user, account, 3, -80, groceries)
    _tx(db_session, user, account, 2, 20, groceries)    # a refund nets out
    _tx(db_session, user, account, 4, -500, gold)       # buying an asset is not spending
    _tx(db_session, user, account, 5, 3000)             # income is not spending
    _tx(db_session, user, account, 9, -999, dining)     # older than the week
    _tx(db_session, user, account, 0, -999, dining)     # today belongs to next week

    summary = weekly_summary.build_summary(db_session, user, user_today(user))

    assert summary.spent == Decimal("180")
    assert summary.top_category == "Dining"
    assert summary.top_amount == Decimal("120")
    assert summary.body().startswith("You spent $180 in the last 7 days, most on Dining ($120).")


def test_reads_split_transactions_line_by_line(db_session, user, account):
    dining = _category(db_session, user, "Dining")
    home = _category(db_session, user, "Home")
    parent = _tx(db_session, user, account, 2, -100, dining)
    db_session.add_all([
        TransactionSplit(transaction_id=parent.id, user_id=user.id, category_id=dining.id, amount=Decimal("-30")),
        TransactionSplit(transaction_id=parent.id, user_id=user.id, category_id=home.id, amount=Decimal("-70")),
    ])
    db_session.commit()

    summary = weekly_summary.build_summary(db_session, user, user_today(user))

    assert summary.spent == Decimal("100")
    assert summary.top_category == "Home"


def test_names_the_bills_due_in_the_coming_week(db_session, user, account):
    today = user_today(user)
    for days, amount in ((0, "-1850"), (6, "-15.99"), (7, "-60"), (3, "4000")):
        db_session.add(RecurringTransaction(
            user_id=user.id, account_id=account.id, amount=Decimal(amount), description="Bill",
            period="monthly", next_date=today + timedelta(days=days), is_active=True, is_variable=False,
        ))
    db_session.commit()

    summary = weekly_summary.build_summary(db_session, user, today)

    # Day 7 is next week's; a positive amount is pay, not a bill.
    assert summary.bills_count == 2
    assert summary.bills_total == Decimal("1865.99")
    assert "2 bills due this week, $1,866 in all." in summary.body()


def test_mentions_the_fullest_budget_once_it_is_three_quarters_used(db_session, user, account):
    today = user_today(user)
    dining = _category(db_session, user, "Dining")
    db_session.add(Budget(user_id=user.id, category_id=dining.id, amount=Decimal("100"), starts_on=today.replace(day=1)))
    db_session.commit()
    _tx(db_session, user, account, 0, -80, dining)

    summary = weekly_summary.build_summary(db_session, user, today)

    assert summary.budget_name == "Dining"
    assert "Dining budget is 80% used." in summary.body()


def test_leaves_a_comfortable_budget_out(db_session, user, account):
    today = user_today(user)
    dining = _category(db_session, user, "Dining")
    db_session.add(Budget(user_id=user.id, category_id=dining.id, amount=Decimal("100"), starts_on=today.replace(day=1)))
    db_session.commit()
    _tx(db_session, user, account, 0, -40, dining)

    assert weekly_summary.build_summary(db_session, user, today).budget_name is None


# ─── When it is sent ──────────────────────────────────────────────────────────
def test_sends_once_a_week_and_links_to_analytics(db_session, user, account):
    _tx(db_session, user, account, 1, -42, _category(db_session, user, "Dining"))
    recorder = Recorder()

    assert weekly_summary.send_weekly_summary(db_session, user, recorder) is True
    assert weekly_summary.send_weekly_summary(db_session, user, recorder) is False  # same week

    assert len(recorder.sent) == 1
    assert recorder.sent[0]["title"] == "Your week"
    assert recorder.sent[0]["url"] == "/?tab=analytics"
    assert recorder.sent[0]["tag"] == "weekly-summary"

    # A week later it is due again.
    user_preferences.upsert(db_session, user.id, {"weekly_summary_sent_on": user_today(user) - timedelta(days=7)})
    db_session.commit()
    assert weekly_summary.send_weekly_summary(db_session, user, recorder) is True


def test_a_quiet_week_sends_nothing_and_marks_nothing(db_session, user, account):
    recorder = Recorder()
    assert weekly_summary.send_weekly_summary(db_session, user, recorder) is False
    assert recorder.sent == []
    row = user_preferences.get_row(db_session, user.id)
    assert row is None or row.weekly_summary_sent_on is None


def test_respects_the_switch(db_session, user, account):
    _tx(db_session, user, account, 1, -42, _category(db_session, user, "Dining"))
    user_preferences.upsert(db_session, user.id, {"weekly_summary_enabled": False})
    db_session.commit()
    recorder = Recorder()

    assert weekly_summary.send_weekly_summary(db_session, user, recorder) is False
    assert recorder.sent == []


def test_cron_reaches_only_subscribed_users_and_only_their_own_numbers(client, db_session, user, account, monkeypatch):
    other = User(
        email="other@example.com", username="other", hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True, is_admin=False,
    )
    db_session.add(other)
    db_session.commit()
    other_account = Account(user_id=other.id, name="Other", type="checking", balance=0, currency="USD")
    db_session.add(other_account)
    db_session.commit()
    unsubscribed = User(
        email="quiet@example.com", username="quiet", hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True, is_admin=False,
    )
    db_session.add(unsubscribed)
    db_session.commit()

    _tx(db_session, user, account, 1, -42, _category(db_session, user, "Dining"))
    _tx(db_session, other, other_account, 1, -900, _category(db_session, other, "Travel"))
    _subscribe(db_session, user, 1)
    _subscribe(db_session, user, 2)  # two devices, still one summary
    _subscribe(db_session, other)

    monkeypatch.setenv("CRON_SECRET", "s")
    recorder = Recorder()
    monkeypatch.setattr(cron, "send_push_to_user", recorder)

    assert client.post("/cron/weekly-summary").status_code == 403
    res = client.post("/cron/weekly-summary", headers={"X-Cron-Secret": "s"})
    assert res.status_code == 200, res.text
    assert res.json() == {"users": 2, "sent": 2}

    by_user = {item["user_id"]: item["body"] for item in recorder.sent}
    assert "$42.00" in by_user[user.id] and "Travel" not in by_user[user.id]
    assert "$900" in by_user[other.id] and "Dining" not in by_user[other.id]
    assert unsubscribed.id not in by_user

    # Running it again in the same week sends nothing new.
    assert client.post("/cron/weekly-summary", headers={"X-Cron-Secret": "s"}).json()["sent"] == 0


def test_one_failing_user_does_not_stop_the_rest(db_session, user, account, monkeypatch):
    _tx(db_session, user, account, 1, -42, _category(db_session, user, "Dining"))
    _subscribe(db_session, user)

    def boom(*_args, **_kwargs):
        raise RuntimeError("push service down")

    assert weekly_summary.send_weekly_summaries(db_session, boom) == {"users": 1, "sent": 0}


# ─── The setting ──────────────────────────────────────────────────────────────
def test_the_setting_defaults_on_and_can_be_turned_off(client, auth_headers):
    assert client.get("/preferences", headers=auth_headers).json()["weekly_summary_enabled"] is True
    res = client.patch("/preferences", headers=auth_headers, json={"weekly_summary_enabled": False})
    assert res.status_code == 200, res.text
    assert res.json()["weekly_summary_enabled"] is False
