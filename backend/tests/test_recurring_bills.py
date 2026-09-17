"""Recurring bills remodel: detection, groups, bank matching, month totals, alerts.

The two regressions these exist for:
  • Detection could only find fixed-price subscriptions, so utilities and yearly
    renewals were never suggested.
  • Bills on bank-linked accounts were posted by the app *and* imported by the
    bank, counting every such charge twice.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.database import Account, Category, RecurringDismissal, RecurringTransaction, Transaction
from services import recurring_bills, recurring_detection, recurring_groups
from services.recurring_schedule import next_occurrence
from utils.dates import user_today

CRON_SECRET = "cron-test-secret"


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _months_ago(today: date, n: int, day_offset: int = 0) -> date:
    d = today
    for _ in range(n):
        d = (d.replace(day=1) - timedelta(days=1)).replace(day=min(today.day, 28))
    return d + timedelta(days=day_offset)


def _tx(db, user, account, when, amount, description, **extra):
    row = Transaction(
        user_id=user.id,
        account_id=account.id,
        amount=Decimal(str(amount)),
        description=description,
        transaction_date=when,
        **extra,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def linked_account(db_session, user):
    acct = Account(user_id=user.id, name="Bank Checking", type="checking", balance=5000,
                   currency="USD", plaid_account_id="plaid-acct-1")
    db_session.add(acct)
    db_session.commit()
    db_session.refresh(acct)
    return acct


def _cron(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", CRON_SECRET)
    return client.post("/cron/process-recurring", headers={"X-Cron-Secret": CRON_SECRET})


# ─── Groups ───────────────────────────────────────────────────────────────────
def test_group_prefers_plaid_detailed_category():
    assert recurring_groups.classify(
        amount_is_income=False, pfc_detailed="RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    ) == "utilities"
    assert recurring_groups.classify(
        amount_is_income=False, pfc_detailed="RENT_AND_UTILITIES_INTERNET_AND_CABLE",
    ) == "phone_internet"


def test_group_falls_back_to_category_name_then_merchant():
    assert recurring_groups.classify(amount_is_income=False, category_name="Car Insurance") == "insurance"
    assert recurring_groups.classify(amount_is_income=False, merchant_key="netflix") == "subscriptions"
    assert recurring_groups.classify(amount_is_income=False, merchant_key="t mobile") == "phone_internet"


def test_gas_category_is_not_filed_as_utilities():
    # "Gas" usually means fuel; guessing utilities would misfile a car cost.
    assert recurring_groups.classify(amount_is_income=False, category_name="Gas") == "other"


def test_group_shape_fallback():
    assert recurring_groups.classify(amount_is_income=False, merchant_key="acme widgets", fixed_amount=True, online=True) == "subscriptions"
    assert recurring_groups.classify(amount_is_income=False, merchant_key="acme widgets") == "other"
    assert recurring_groups.classify(amount_is_income=True, merchant_key="payroll") == "income"


# ─── Detection ────────────────────────────────────────────────────────────────
def test_detects_fixed_monthly_subscription(db_session, user, account):
    today = user_today(user)
    for n in (3, 2, 1):
        _tx(db_session, user, account, _months_ago(today, n), "-15.49", "NETFLIX.COM", payment_channel="online")

    found = recurring_detection.detect(db_session, user.id, today)
    assert len(found) == 1
    s = found[0]
    assert s.period == "monthly"
    assert s.group_key == "subscriptions"
    assert s.is_variable is False
    assert s.amount == Decimal("-15.49")
    assert s.next_date == next_occurrence(_months_ago(today, 1), "monthly")


def test_detects_variable_utility_after_two_bills(db_session, user, account):
    """The bill the old detector could never find: the amount swings every
    month, and a new utility should show up after its second bill."""
    today = user_today(user)
    _tx(db_session, user, account, _months_ago(today, 2), "-84.10", "CITY POWER CO",
        personal_finance_category_primary="RENT_AND_UTILITIES",
        personal_finance_category_detailed="RENT_AND_UTILITIES_GAS_AND_ELECTRICITY")
    _tx(db_session, user, account, _months_ago(today, 1), "-131.62", "CITY POWER CO",
        personal_finance_category_primary="RENT_AND_UTILITIES",
        personal_finance_category_detailed="RENT_AND_UTILITIES_GAS_AND_ELECTRICITY")

    found = recurring_detection.detect(db_session, user.id, today)
    assert len(found) == 1
    assert found[0].group_key == "utilities"
    assert found[0].is_variable is True
    assert found[0].confidence == "high"


def test_ignores_varying_spend_at_an_ordinary_shop(db_session, user, account):
    today = user_today(user)
    for n, amount in ((4, "-22.10"), (3, "-61.80"), (2, "-35.00"), (1, "-90.25")):
        _tx(db_session, user, account, _months_ago(today, n), amount, "CORNER BISTRO", payment_channel="in store")
    assert recurring_detection.detect(db_session, user.id, today) == []


def test_detects_yearly_renewal(db_session, user, account):
    today = user_today(user)
    _tx(db_session, user, account, today - timedelta(days=400), "-99.00", "AMAZON PRIME ANNUAL", payment_channel="online")
    _tx(db_session, user, account, today - timedelta(days=35), "-99.00", "AMAZON PRIME ANNUAL", payment_channel="online")
    found = recurring_detection.detect(db_session, user.id, today)
    assert [s.period for s in found] == ["yearly"]


def test_lapsed_subscription_is_not_suggested(db_session, user, account):
    today = user_today(user)
    for n in (8, 7, 6):
        _tx(db_session, user, account, _months_ago(today, n), "-9.99", "OLD STREAMING APP", payment_channel="online")
    assert recurring_detection.detect(db_session, user.id, today) == []


def test_card_payments_are_never_bills(db_session, user):
    today = user_today(user)
    card = Account(user_id=user.id, name="Card", type="credit_card", balance=-100, currency="USD")
    db_session.add(card)
    db_session.commit()
    for n in (3, 2, 1):
        _tx(db_session, user, card, _months_ago(today, n), "500.00", "PAYMENT THANK YOU")
    assert recurring_detection.detect(db_session, user.id, today) == []


def test_detects_paycheck_as_income(db_session, user, account):
    today = user_today(user)
    for weeks in (6, 4, 2):
        _tx(db_session, user, account, today - timedelta(weeks=weeks), "2100.00", "ACME PAYROLL")
    found = recurring_detection.detect(db_session, user.id, today)
    assert len(found) == 1
    assert found[0].is_income and found[0].group_key == "income" and found[0].period == "biweekly"


def test_tracked_and_dismissed_charges_are_not_suggested(db_session, user, account):
    today = user_today(user)
    for n in (3, 2, 1):
        _tx(db_session, user, account, _months_ago(today, n), "-15.49", "NETFLIX.COM", payment_channel="online")
        _tx(db_session, user, account, _months_ago(today, n, 2), "-10.99", "SPOTIFY USA", payment_channel="online")

    db_session.add(RecurringTransaction(user_id=user.id, account_id=account.id, amount=Decimal("-15.49"),
                                        description="Netflix", period="monthly", next_date=today, is_active=True))
    identity = next(s.identity for s in recurring_detection.detect(db_session, user.id, today) if "Spotify" in s.name)
    db_session.add(RecurringDismissal(user_id=user.id, identity=identity))
    db_session.commit()

    assert recurring_detection.detect(db_session, user.id, today) == []


# ─── Suggestions API ──────────────────────────────────────────────────────────
def test_confirm_suggestion_tracks_it_with_group_and_payment(client, db_session, user, auth_headers, account):
    today = user_today(user)
    charges = [
        _tx(db_session, user, account, _months_ago(today, n), "-15.49", "NETFLIX.COM", payment_channel="online")
        for n in (3, 2, 1)
    ]
    overview = client.get("/recurring/overview", headers=auth_headers).json()
    [suggestion] = overview["suggestions"]
    assert suggestion["group_key"] == "subscriptions"
    assert suggestion["reasons"][0] == "3 charges"

    response = client.post("/recurring/suggestions/confirm", headers=auth_headers,
                           json={"identity": suggestion["identity"], "name": "Netflix"})
    assert response.status_code == 201
    body = response.json()
    assert body["description"] == "Netflix"
    assert body["group_key"] == "subscriptions"
    assert body["source"] == "detected"
    assert body["last_paid_date"] == charges[-1].transaction_date.isoformat()

    after = client.get("/recurring/overview", headers=auth_headers).json()
    assert after["suggestions"] == []
    assert [g["key"] for g in after["groups"]] == ["subscriptions"]


def test_confirm_can_choose_the_group(client, db_session, user, auth_headers, account):
    today = user_today(user)
    for n in (3, 2, 1):
        _tx(db_session, user, account, _months_ago(today, n), "-40.00", "ACME WIDGETS", payment_channel="online")
    identity = client.get("/recurring/overview", headers=auth_headers).json()["suggestions"][0]["identity"]
    body = client.post("/recurring/suggestions/confirm", headers=auth_headers,
                       json={"identity": identity, "group_key": "insurance"}).json()
    assert body["group_key"] == "insurance"


def test_confirm_unknown_suggestion_is_404(client, auth_headers):
    response = client.post("/recurring/suggestions/confirm", headers=auth_headers, json={"identity": "key:nothing"})
    assert response.status_code == 404


def test_dismiss_is_permanent_and_idempotent(client, db_session, user, auth_headers, account):
    today = user_today(user)
    for n in (3, 2, 1):
        _tx(db_session, user, account, _months_ago(today, n), "-15.49", "NETFLIX.COM", payment_channel="online")
    identity = client.get("/recurring/overview", headers=auth_headers).json()["suggestions"][0]["identity"]
    for _ in range(2):
        assert client.post("/recurring/suggestions/dismiss", headers=auth_headers, json={"identity": identity}).status_code == 204
    assert client.get("/recurring/overview", headers=auth_headers).json()["suggestions"] == []


# ─── Groups API ───────────────────────────────────────────────────────────────
def test_create_assigns_a_group_and_move_persists(client, auth_headers, account):
    created = client.post("/recurring/", headers=auth_headers, json={
        "account_id": account.id, "amount": "-89.00", "description": "Xfinity Internet",
        "period": "monthly", "next_date": "2030-01-05",
    }).json()
    assert created["group_key"] == "phone_internet"

    moved = client.patch(f"/recurring/{created['id']}", headers=auth_headers, json={"group_key": "utilities"})
    assert moved.status_code == 200 and moved.json()["group_key"] == "utilities"

    bad = client.patch(f"/recurring/{created['id']}", headers=auth_headers, json={"group_key": "groceries"})
    assert bad.status_code == 422


def test_legacy_rows_get_a_group_on_read(client, db_session, user, auth_headers, account):
    db_session.add(RecurringTransaction(user_id=user.id, account_id=account.id, amount=Decimal("-12.99"),
                                        description="Spotify", period="monthly", next_date=date(2030, 1, 1), is_active=True))
    db_session.commit()
    rows = client.get("/recurring/", headers=auth_headers).json()
    assert rows[0]["group_key"] == "subscriptions"


# ─── Bank-linked bills are matched, never posted ──────────────────────────────
def _bill(db, user, account, **overrides):
    values = dict(user_id=user.id, account_id=account.id, amount=Decimal("-15.49"), description="Netflix",
                  merchant_key="netflix", period="monthly", next_date=user_today(user) - timedelta(days=1),
                  is_active=True, is_variable=False, group_key="subscriptions")
    values.update(overrides)
    rec = RecurringTransaction(**values)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def test_process_due_does_not_post_linked_bills(client, db_session, user, auth_headers, linked_account):
    rec = _bill(db_session, user, linked_account)
    response = client.post("/recurring/process-due", headers=auth_headers)
    assert response.status_code == 200 and response.json() == []
    assert db_session.query(Transaction).count() == 0
    db_session.expire_all()
    assert db_session.get(RecurringTransaction, rec.id).next_date == rec.next_date


def test_cron_does_not_post_linked_bills(client, db_session, user, linked_account, monkeypatch):
    _bill(db_session, user, linked_account)
    assert _cron(client, monkeypatch).json()["processed"] == 0
    assert db_session.query(Transaction).count() == 0


def test_imported_charge_marks_linked_bill_paid(client, db_session, user, auth_headers, linked_account):
    rec = _bill(db_session, user, linked_account)
    due = rec.next_date
    charge = _tx(db_session, user, linked_account, due, "-15.49", "NETFLIX.COM", merchant_key="netflix")

    overview = client.get("/recurring/overview", headers=auth_headers).json()
    db_session.expire_all()
    stored = db_session.get(RecurringTransaction, rec.id)
    assert stored.last_transaction_id == charge.id
    assert stored.next_date == next_occurrence(due, "monthly")
    bill = overview["groups"][0]["bills"][0]
    assert bill["linked"] is True

    # Reading again must not apply the same charge twice.
    client.get("/recurring/overview", headers=auth_headers)
    db_session.expire_all()
    assert db_session.get(RecurringTransaction, rec.id).next_date == next_occurrence(due, "monthly")


def test_price_rise_is_recorded_and_alerted_once(db_session, user, linked_account):
    today = user_today(user)
    rec = _bill(db_session, user, linked_account, next_date=today)
    _tx(db_session, user, linked_account, today, "-17.99", "NETFLIX.COM", merchant_key="netflix")

    assert recurring_bills.reconcile_user(db_session, user, today=today) == 1
    db_session.commit()
    db_session.refresh(rec)
    assert rec.amount == Decimal("-17.99") and rec.previous_amount == Decimal("-15.49")

    first = recurring_bills.collect_alerts(db_session, user, today)
    db_session.commit()
    assert any("went up" in a.title for a in first)
    second = recurring_bills.collect_alerts(db_session, user, today)
    assert not any("went up" in a.title for a in second)


def test_one_off_purchase_at_same_merchant_does_not_pay_the_bill(db_session, user, linked_account):
    today = user_today(user)
    rec = _bill(db_session, user, linked_account, next_date=today, amount=Decimal("-15.49"))
    _tx(db_session, user, linked_account, today, "-240.00", "NETFLIX.COM", merchant_key="netflix")
    assert recurring_bills.reconcile_user(db_session, user, today=today) == 0
    assert rec.last_transaction_id is None


def test_linked_bill_missing_past_its_window_is_flagged(db_session, user, linked_account):
    today = user_today(user)
    rec = _bill(db_session, user, linked_account, next_date=today - timedelta(days=15))
    status = recurring_bills.bill_status(rec, linked_account, today)
    assert status.code == "missed"

    alerts = recurring_bills.collect_alerts(db_session, user, today)
    db_session.commit()
    assert any("No Netflix charge" in a.title for a in alerts)
    assert not any("No Netflix charge" in a.title for a in recurring_bills.collect_alerts(db_session, user, today))


def test_due_soon_reminder_is_sent_once_per_cycle(db_session, user, account):
    today = user_today(user)
    _bill(db_session, user, account, next_date=today + timedelta(days=2), description="Rent", merchant_key="rent",
          amount=Decimal("-1850.00"), group_key="housing")
    alerts = recurring_bills.collect_alerts(db_session, user, today)
    db_session.commit()
    assert alerts[0].title == "Rent is due in 2 days"
    assert recurring_bills.collect_alerts(db_session, user, today) == []


# ─── Month totals ─────────────────────────────────────────────────────────────
def test_month_total_is_paid_plus_still_due_without_overlap(client, db_session, user, auth_headers, account, linked_account):
    today = user_today(user)
    month_start, month_end = recurring_bills.month_bounds(today)

    # Paid earlier this month on the bank account (skip on the 1st: nothing is "earlier").
    paid_expected = Decimal("0")
    if today > month_start:
        paid_day = month_start
        _bill(db_session, user, linked_account, next_date=paid_day, description="Netflix", merchant_key="netflix")
        _tx(db_session, user, linked_account, paid_day, "-15.49", "NETFLIX.COM", merchant_key="netflix")
        paid_expected = Decimal("15.49")

    # Still due later this month, or next month when today is the last day.
    later = min(today + timedelta(days=1), month_end)
    remaining_expected = Decimal("0")
    if later > today:
        _bill(db_session, user, account, next_date=later, description="Rent", merchant_key="rent",
              amount=Decimal("-1850.00"), group_key="housing")
        remaining_expected = Decimal("1850.00")

    body = client.get("/recurring/overview", headers=auth_headers).json()
    assert Decimal(body["paid_this_month"]) == paid_expected
    assert Decimal(body["remaining_this_month"]) == remaining_expected
    assert Decimal(body["expected_this_month"]) == paid_expected + remaining_expected


def test_typical_monthly_normalises_every_cadence(client, db_session, user, auth_headers, account):
    far = date(2030, 1, 1)
    _bill(db_session, user, account, amount=Decimal("-120.00"), period="yearly", next_date=far, description="Domain")
    _bill(db_session, user, account, amount=Decimal("-10.00"), period="weekly", next_date=far, description="Paper")
    body = client.get("/recurring/overview", headers=auth_headers).json()
    # 120/12 + 10*52/12 = 10.00 + 43.33
    assert Decimal(body["typical_monthly"]) == Decimal("53.33")


def test_income_and_paused_are_kept_out_of_bill_totals(client, db_session, user, auth_headers, account):
    far = date(2030, 1, 1)
    _bill(db_session, user, account, amount=Decimal("3000.00"), description="Salary", next_date=far, group_key="income")
    _bill(db_session, user, account, amount=Decimal("-50.00"), description="Old gym", next_date=far, is_active=False)
    body = client.get("/recurring/overview", headers=auth_headers).json()
    assert Decimal(body["typical_monthly"]) == 0
    assert body["groups"] == []
    assert [b["description"] for b in body["income"]] == ["Salary"]
    assert [b["description"] for b in body["paused"]] == ["Old gym"]


# ─── Same bill, different name ────────────────────────────────────────────────
def test_bill_named_differently_from_the_bank_is_not_suggested_twice(db_session, user, account):
    """Found in a live seed: rent tracked as "Rent" was also suggested as the
    bank's "Landlord", and tracking both counted $1,850 twice."""
    today = user_today(user)
    rent = Category(name="Rent", type="expense", color="#F97316", user_id=user.id)
    db_session.add(rent)
    db_session.commit()
    for n in (3, 2, 1):
        _tx(db_session, user, account, _months_ago(today, n), "-1850.00", "Landlord", category_id=rent.id)
    db_session.add(RecurringTransaction(user_id=user.id, account_id=account.id, category_id=rent.id,
                                        amount=Decimal("-1850.00"), description="Rent", period="monthly",
                                        next_date=today + timedelta(days=2), is_active=True))
    db_session.commit()
    assert recurring_detection.detect(db_session, user.id, today) == []


def test_differently_named_charge_pays_the_bill_when_category_account_and_amount_agree(db_session, user, linked_account):
    today = user_today(user)
    rent = Category(name="Rent", type="expense", color="#F97316", user_id=user.id)
    db_session.add(rent)
    db_session.commit()
    rec = _bill(db_session, user, linked_account, description="Rent", merchant_key="rent", category_id=rent.id,
                amount=Decimal("-1850.00"), next_date=today, group_key="housing")
    other = _tx(db_session, user, linked_account, today, "-1850.00", "ZELLE TO LANDLORD", category_id=rent.id)
    assert recurring_bills.reconcile_user(db_session, user, today=today) == 1
    assert rec.last_transaction_id == other.id


def test_category_match_needs_a_close_amount(db_session, user, linked_account):
    today = user_today(user)
    rent = Category(name="Rent", type="expense", color="#F97316", user_id=user.id)
    db_session.add(rent)
    db_session.commit()
    _bill(db_session, user, linked_account, description="Rent", merchant_key="rent", category_id=rent.id,
          amount=Decimal("-1850.00"), next_date=today, group_key="housing")
    _tx(db_session, user, linked_account, today, "-240.00", "HOME DEPOT", category_id=rent.id)
    assert recurring_bills.reconcile_user(db_session, user, today=today) == 0


# ─── Healthcare ───────────────────────────────────────────────────────────────
def test_healthcare_is_its_own_group():
    assert recurring_groups.classify(amount_is_income=False, pfc_detailed="MEDICAL_DENTAL_CARE") == "healthcare"
    assert recurring_groups.classify(amount_is_income=False, category_name="Healthcare") == "healthcare"
    assert recurring_groups.classify(amount_is_income=False, merchant_key="invisalign") == "healthcare"


def test_in_store_aligner_plan_is_suggested(db_session, user, account):
    """The case that prompted the group: a fixed monthly treatment plan the
    office charges in person was skipped as an ordinary in-store purchase."""
    today = user_today(user)
    health = Category(name="Healthcare", type="expense", color="#14B8A6", user_id=user.id)
    db_session.add(health)
    db_session.commit()
    for n in (6, 5, 4, 3, 2, 1):
        _tx(db_session, user, account, _months_ago(today, n), "-189.00", "SMILE ORTHO GROUP",
            category_id=health.id, payment_channel="in store")

    found = recurring_detection.detect(db_session, user.id, today)
    assert [(s.group_key, s.period, s.is_variable) for s in found] == [("healthcare", "monthly", False)]


def test_varying_pharmacy_runs_are_not_suggested(db_session, user, account):
    today = user_today(user)
    for n, amount in ((4, "-12.40"), (3, "-58.10"), (2, "-23.75"), (1, "-71.20")):
        _tx(db_session, user, account, _months_ago(today, n), amount, "CVS PHARMACY", payment_channel="in store",
            personal_finance_category_primary="MEDICAL",
            personal_finance_category_detailed="MEDICAL_PHARMACIES_AND_SUPPLEMENTS")
    assert recurring_detection.detect(db_session, user.id, today) == []


def test_bills_can_be_moved_to_healthcare(client, auth_headers, account):
    created = client.post("/recurring/", headers=auth_headers, json={
        "account_id": account.id, "amount": "-189.00", "description": "Aligners",
        "period": "monthly", "next_date": "2030-01-05",
    }).json()
    moved = client.patch(f"/recurring/{created['id']}", headers=auth_headers, json={"group_key": "healthcare"})
    assert moved.status_code == 200 and moved.json()["group_key"] == "healthcare"


def test_fitness_category_stays_a_subscription():
    assert recurring_groups.classify(amount_is_income=False, category_name="Health & Fitness") == "subscriptions"
