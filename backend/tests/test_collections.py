"""Collections: grouping transactions (a trip, a holiday, a move) and adding up the cost."""

from datetime import date, timedelta
from decimal import Decimal
import json

import pytest

from models.auth import User
from models.database import (
    Account,
    Category,
    Collection,
    utc_now,
    CollectionTransaction,
    RecurringTransaction,
    Transaction,
    TransactionSplit,
)
from services import collections as collection_service
from utils import auth as auth_utils
from utils.dates import user_today


# ─── Fixtures ─────────────────────────────────────────────────────────────────
@pytest.fixture
def today(user):
    return user_today(user)


@pytest.fixture
def card(db_session, user):
    row = Account(user_id=user.id, name="Visa", type="credit_card", balance=Decimal("-200.00"), currency="USD")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def salary(db_session, user):
    row = Category(user_id=user.id, name="Salary", type="income", color="#00aa00")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def gold(db_session, user):
    row = Category(user_id=user.id, name="Gold", type="investment", color="#ffcc00")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def other_user(db_session):
    row = User(email="other@example.com", username="other", hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def other_headers(other_user):
    return {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(other_user.id)})}"}


def _tx(db, user, account, amount, description, day, category=None, created_at=None):
    row = Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id if category else None,
        amount=Decimal(amount), description=description, transaction_date=day,
    )
    if created_at is not None:
        row.created_at = created_at
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _create(client, headers, **body):
    body.setdefault("name", "Ohio trip")
    response = client.post("/collections/", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# ─── Create / read / update / delete ──────────────────────────────────────────
def test_create_collection_starts_empty(client, auth_headers, today):
    body = _create(
        client, auth_headers, name="  Ohio   trip ", emoji="🚗", color="#3366ff", note="Family visit",
        start_date=str(today - timedelta(days=2)), end_date=str(today + timedelta(days=3)), budget="1500",
    )

    assert body["name"] == "Ohio trip"
    assert body["emoji"] == "🚗" and body["color"] == "#3366ff" and body["note"] == "Family visit"
    assert body["budget"] == "1500.00"
    assert body["active"] is True and body["is_archived"] is False
    assert body["totals"] == {"spent": "0", "returned": "0", "net": "0", "count": 0, "first_date": None, "last_date": None}


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"name": "   "}, "name"),
        ({"name": "Trip", "start_date": "2026-05-10", "end_date": "2026-05-01"}, "before the start"),
        ({"name": "Trip", "end_date": "2026-05-01"}, "start date"),
        ({"name": "Trip", "color": "blue"}, "#RRGGBB"),
        ({"name": "Trip", "budget": "0"}, "greater than"),
    ],
)
def test_create_rejects_bad_input(client, auth_headers, payload, message):
    response = client.post("/collections/", json=payload, headers=auth_headers)
    assert response.status_code == 422
    assert message in response.text


def test_names_are_unique_per_user_ignoring_case(client, auth_headers, other_headers):
    _create(client, auth_headers, name="Ohio trip")
    assert client.post("/collections/", json={"name": "OHIO TRIP"}, headers=auth_headers).status_code == 409
    # Someone else can use the same name.
    assert client.post("/collections/", json={"name": "Ohio trip"}, headers=other_headers).status_code == 201


def test_list_puts_active_first_and_archived_last(client, auth_headers, today):
    old = _create(client, auth_headers, name="Old move", start_date="2025-01-01", end_date="2025-01-05")
    _create(client, auth_headers, name="Archived", start_date="2026-01-01")
    archived_id = client.get("/collections/", headers=auth_headers).json()
    archived_id = next(c["id"] for c in archived_id if c["name"] == "Archived")
    client.put(f"/collections/{archived_id}", json={"is_archived": True}, headers=auth_headers)
    _create(client, auth_headers, name="Now", start_date=str(today))
    _create(client, auth_headers, name="Undated")

    names = [c["name"] for c in client.get("/collections/", headers=auth_headers).json()]

    assert names[0] == "Now"
    assert names[-1] == "Archived"
    assert set(names[1:3]) == {"Old move", "Undated"}
    assert old["active"] is False


def test_update_renames_archives_and_clears_fields(client, auth_headers):
    created = _create(client, auth_headers, budget="200", note="x", start_date="2026-03-01", end_date="2026-03-04")
    _create(client, auth_headers, name="Taken")
    url = f"/collections/{created['id']}"

    assert client.put(url, json={"name": "taken"}, headers=auth_headers).status_code == 409
    assert client.put(url, json={"name": None}, headers=auth_headers).status_code == 422
    assert client.put(url, json={"end_date": "2026-02-01"}, headers=auth_headers).status_code == 422
    assert client.put(url, json={"start_date": None}, headers=auth_headers).status_code == 422

    body = client.put(url, json={"name": "Ohio road trip", "budget": None, "note": " ", "is_archived": True}, headers=auth_headers).json()
    assert body["name"] == "Ohio road trip"
    assert body["budget"] is None and body["note"] is None
    assert body["is_archived"] is True and body["active"] is False

    body = client.put(url, json={"is_archived": None, "start_date": None, "end_date": None}, headers=auth_headers).json()
    assert body["is_archived"] is True
    assert body["start_date"] is None and body["end_date"] is None


def test_delete_keeps_the_transactions(client, db_session, user, account, auth_headers, today):
    tx = _tx(db_session, user, account, "-40.00", "Diner", today)
    created = _create(client, auth_headers)
    client.post(f"/collections/{created['id']}/transactions", json={"transaction_ids": [tx.id]}, headers=auth_headers)

    assert client.delete(f"/collections/{created['id']}", headers=auth_headers).status_code == 204

    db_session.expire_all()
    assert db_session.get(Transaction, tx.id) is not None
    assert db_session.query(CollectionTransaction).count() == 0
    assert client.get(f"/collections/{created['id']}", headers=auth_headers).status_code == 404


# ─── Membership and totals ────────────────────────────────────────────────────
def test_totals_follow_the_analytics_money_rules(client, db_session, user, account, card, category, salary, gold, auth_headers, today):
    spend = _tx(db_session, user, card, "-120.00", "Hotel", today, category)
    refund = _tx(db_session, user, card, "20.00", "Hotel refund", today, category)
    payback = _tx(db_session, user, account, "30.00", "Sam paid me back", today - timedelta(days=1))
    bought = _tx(db_session, user, account, "-500.00", "Gold coin", today, gold)
    card_payment = _tx(db_session, user, card, "100.00", "Payment thank you", today)
    created = _create(client, auth_headers)

    response = client.post(
        f"/collections/{created['id']}/transactions",
        json={"transaction_ids": [spend.id, refund.id, payback.id, bought.id, card_payment.id]},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["added"], body["already"], body["skipped_card_payments"]) == (4, 0, 1)
    totals = body["collection"]["totals"]
    # 120 spent; 20 refund + 30 payback came back; gold is not spending.
    assert totals["spent"] == "120.00" and totals["returned"] == "50.00" and totals["net"] == "70.00"
    assert totals["count"] == 4
    assert totals["first_date"] == str(today - timedelta(days=1)) and totals["last_date"] == str(today)

    again = client.post(f"/collections/{created['id']}/transactions", json={"transaction_ids": [spend.id]}, headers=auth_headers).json()
    assert (again["added"], again["already"]) == (0, 1)


def test_one_transaction_can_be_in_several_collections(client, db_session, user, account, auth_headers, today):
    hotel = _tx(db_session, user, account, "-300.00", "Hotel", today)
    trip = _create(client, auth_headers, name="Ohio trip")
    work = _create(client, auth_headers, name="Reimbursable")
    for collection in (trip, work):
        client.post(f"/collections/{collection['id']}/transactions", json={"transaction_ids": [hotel.id]}, headers=auth_headers)

    listed = {c["name"]: c["totals"]["net"] for c in client.get("/collections/", headers=auth_headers).json()}
    assert listed == {"Ohio trip": "300.00", "Reimbursable": "300.00"}
    tx = client.get(f"/transactions/{hotel.id}", headers=auth_headers).json()
    assert tx["collection_ids"] == sorted([trip["id"], work["id"]])


def test_remove_takes_transactions_out_but_keeps_them(client, db_session, user, account, auth_headers, today):
    a = _tx(db_session, user, account, "-10.00", "Coffee", today)
    b = _tx(db_session, user, account, "-15.00", "Lunch", today)
    created = _create(client, auth_headers)
    url = f"/collections/{created['id']}/transactions"
    client.post(url, json={"transaction_ids": [a.id, b.id]}, headers=auth_headers)

    body = client.post(f"{url}/remove", json={"transaction_ids": [a.id]}, headers=auth_headers).json()

    assert body["removed"] == 1
    assert body["collection"]["totals"]["net"] == "15.00"
    assert db_session.get(Transaction, a.id) is not None


def test_adding_someone_elses_transaction_is_rejected(client, db_session, other_user, auth_headers, today):
    theirs_account = Account(user_id=other_user.id, name="Theirs", type="checking", balance=0)
    db_session.add(theirs_account)
    db_session.commit()
    theirs = _tx(db_session, other_user, theirs_account, "-5.00", "Theirs", today)
    created = _create(client, auth_headers)

    response = client.post(f"/collections/{created['id']}/transactions", json={"transaction_ids": [theirs.id]}, headers=auth_headers)

    assert response.status_code == 404
    assert db_session.query(CollectionTransaction).count() == 0


def test_transactions_can_be_filtered_by_collection(client, db_session, user, account, auth_headers, today):
    inside = _tx(db_session, user, account, "-10.00", "Gas", today)
    _tx(db_session, user, account, "-99.00", "Rent", today)
    created = _create(client, auth_headers)
    client.post(f"/collections/{created['id']}/transactions", json={"transaction_ids": [inside.id]}, headers=auth_headers)

    rows = client.get(f"/transactions/?collection_id={created['id']}", headers=auth_headers).json()

    assert [r["description"] for r in rows] == ["Gas"]
    assert rows[0]["collection_ids"] == [created["id"]]
    every = client.get("/transactions/", headers=auth_headers).json()
    assert {r["description"]: r["collection_ids"] for r in every} == {"Gas": [created["id"]], "Rent": []}


def test_other_users_collection_filter_returns_nothing(client, db_session, user, account, auth_headers, other_headers, today):
    tx = _tx(db_session, user, account, "-10.00", "Gas", today)
    mine = _create(client, auth_headers)
    client.post(f"/collections/{mine['id']}/transactions", json={"transaction_ids": [tx.id]}, headers=auth_headers)

    assert client.get(f"/transactions/?collection_id={mine['id']}", headers=other_headers).json() == []


def test_set_collections_for_one_transaction(client, db_session, user, account, card, auth_headers, other_headers, today):
    tx = _tx(db_session, user, account, "-60.00", "Museum", today)
    trip = _create(client, auth_headers, name="Ohio trip")
    gifts = _create(client, auth_headers, name="Gifts")
    url = f"/transactions/{tx.id}/collections"

    body = client.put(url, json={"collection_ids": [trip["id"], gifts["id"]]}, headers=auth_headers).json()
    assert body["collection_ids"] == sorted([trip["id"], gifts["id"]])

    body = client.put(url, json={"collection_ids": [gifts["id"]]}, headers=auth_headers).json()
    assert body["collection_ids"] == [gifts["id"]]

    body = client.put(url, json={"collection_ids": []}, headers=auth_headers).json()
    assert body["collection_ids"] == []

    theirs = client.post("/collections/", json={"name": "Theirs"}, headers=other_headers).json()
    assert client.put(url, json={"collection_ids": [theirs["id"]]}, headers=auth_headers).status_code == 404

    payment = _tx(db_session, user, card, "50.00", "Payment", today)
    response = client.put(f"/transactions/{payment.id}/collections", json={"collection_ids": [trip["id"]]}, headers=auth_headers)
    assert response.status_code == 422


def test_new_transaction_can_go_straight_into_a_collection(client, db_session, account, card, auth_headers, other_headers, today):
    trip = _create(client, auth_headers)

    response = client.post(
        "/transactions/",
        json={"account_id": account.id, "amount": "-25.00", "description": "Tolls", "transaction_date": str(today), "collection_ids": [trip["id"]]},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["collection_ids"] == [trip["id"]]
    db_session.expire_all()
    assert db_session.get(Account, account.id).balance == Decimal("975.00")

    theirs = client.post("/collections/", json={"name": "Theirs"}, headers=other_headers).json()
    bad = client.post(
        "/transactions/",
        json={"account_id": account.id, "amount": "-5.00", "description": "Nope", "transaction_date": str(today), "collection_ids": [theirs["id"]]},
        headers=auth_headers,
    )
    assert bad.status_code == 404
    db_session.expire_all()
    assert db_session.get(Account, account.id).balance == Decimal("975.00")  # nothing was posted
    assert db_session.query(Transaction).filter(Transaction.description == "Nope").count() == 0

    payment = client.post(
        "/transactions/",
        json={"account_id": card.id, "amount": "40.00", "description": "Payment", "transaction_date": str(today), "collection_ids": [trip["id"]]},
        headers=auth_headers,
    )
    assert payment.status_code == 422

    missing_account = client.post(
        "/transactions/",
        json={"account_id": 99999, "amount": "-5.00", "transaction_date": str(today), "collection_ids": [trip["id"]]},
        headers=auth_headers,
    )
    assert missing_account.status_code == 404


def test_deleting_a_transaction_removes_it_from_collections(client, db_session, user, account, auth_headers, today):
    tx = _tx(db_session, user, account, "-12.00", "Snacks", today)
    created = _create(client, auth_headers)
    client.post(f"/collections/{created['id']}/transactions", json={"transaction_ids": [tx.id]}, headers=auth_headers)

    assert client.delete(f"/transactions/{tx.id}", headers=auth_headers).status_code == 204

    body = client.get(f"/collections/{created['id']}", headers=auth_headers).json()
    assert body["totals"]["count"] == 0


# ─── Suggestions ──────────────────────────────────────────────────────────────
def test_suggestions_cover_the_dates_and_flag_what_does_not_look_like_the_trip(
    client, db_session, user, account, card, category, salary, auth_headers, today,
):
    start = today - timedelta(days=5)
    db_session.add(RecurringTransaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-15.49"), description="Netflix",
        period="monthly", next_date=today + timedelta(days=20), is_active=True,
    ))
    db_session.commit()
    diner = _tx(db_session, user, card, "-45.00", "Diner", start + timedelta(days=1), category)
    netflix = _tx(db_session, user, card, "-15.49", "Netflix", start + timedelta(days=2))
    pay = _tx(db_session, user, account, "2000.00", "Payroll", start + timedelta(days=2), salary)
    _tx(db_session, user, card, "300.00", "Card payment", start + timedelta(days=3))  # never suggested
    _tx(db_session, user, card, "-80.00", "Before the trip", start - timedelta(days=1))
    already = _tx(db_session, user, card, "-30.00", "Gas", start)
    created = _create(client, auth_headers, start_date=str(start), end_date=str(today))
    client.post(f"/collections/{created['id']}/transactions", json={"transaction_ids": [already.id]}, headers=auth_headers)

    rows = client.get(f"/collections/{created['id']}/suggestions", headers=auth_headers).json()

    by_id = {r["transaction"]["id"]: (r["recommended"], r["reason"]) for r in rows}
    assert by_id == {
        diner.id: (True, None),
        netflix.id: (False, "Regular bill"),
        pay.id: (False, "Money in"),
    }
    listed = client.get(f"/collections/{created['id']}", headers=auth_headers).json()
    assert listed["suggestion_count"] == 1


def test_reviewing_adds_the_picked_ones_and_only_new_ones_come_back(client, db_session, user, account, auth_headers, today):
    start = today - timedelta(days=3)
    keep = _tx(db_session, user, account, "-50.00", "Motel", start)
    skip = _tx(db_session, user, account, "-9.00", "Pharmacy", start + timedelta(days=1))
    created = _create(client, auth_headers, start_date=str(start))
    url = f"/collections/{created['id']}/suggestions"

    body = client.post(f"{url}/review", json={"add_ids": [keep.id]}, headers=auth_headers).json()

    assert body["added"] == 1
    assert body["collection"]["totals"]["net"] == "50.00"
    assert client.get(url, headers=auth_headers).json() == []
    # A charge that arrives after the review is suggested; the dismissed one is not.
    later = _tx(db_session, user, account, "-22.00", "Gas station", today, created_at=utc_now() + timedelta(seconds=5))
    assert [r["transaction"]["id"] for r in client.get(url, headers=auth_headers).json()] == [later.id]
    # Asking for everything brings back the dismissed one too.
    every = {r["transaction"]["id"] for r in client.get(f"{url}?all=true", headers=auth_headers).json()}
    assert every == {later.id, skip.id}


def test_undated_collections_have_no_suggestions(client, db_session, user, account, auth_headers, today):
    _tx(db_session, user, account, "-10.00", "Anything", today)
    created = _create(client, auth_headers)

    assert client.get(f"/collections/{created['id']}/suggestions", headers=auth_headers).json() == []


def test_review_rejects_someone_elses_transaction(client, db_session, other_user, auth_headers, today):
    theirs_account = Account(user_id=other_user.id, name="Theirs", type="checking", balance=0)
    db_session.add(theirs_account)
    db_session.commit()
    theirs = _tx(db_session, other_user, theirs_account, "-5.00", "Theirs", today)
    created = _create(client, auth_headers, start_date=str(today))

    response = client.post(f"/collections/{created['id']}/suggestions/review", json={"add_ids": [theirs.id]}, headers=auth_headers)

    assert response.status_code == 404


# ─── Isolation ────────────────────────────────────────────────────────────────
def test_someone_elses_collection_is_invisible(client, auth_headers, other_headers):
    theirs = client.post("/collections/", json={"name": "Theirs"}, headers=other_headers).json()
    base = f"/collections/{theirs['id']}"

    assert client.get(base, headers=auth_headers).status_code == 404
    assert client.put(base, json={"name": "Mine now"}, headers=auth_headers).status_code == 404
    assert client.delete(base, headers=auth_headers).status_code == 404
    assert client.post(f"{base}/transactions", json={"transaction_ids": [1]}, headers=auth_headers).status_code == 404
    assert client.post(f"{base}/transactions/remove", json={"transaction_ids": [1]}, headers=auth_headers).status_code == 404
    assert client.get(f"{base}/suggestions", headers=auth_headers).status_code == 404
    assert client.post(f"{base}/suggestions/review", json={"add_ids": []}, headers=auth_headers).status_code == 404
    assert client.get("/collections/", headers=auth_headers).json() == []


# ─── Service details ──────────────────────────────────────────────────────────
def test_is_active_needs_a_start_and_respects_the_end():
    today = date(2026, 11, 4)
    assert not collection_service.is_active(Collection(name="x", is_archived=False), today)
    assert collection_service.is_active(Collection(name="x", is_archived=False, start_date=today), today)
    assert not collection_service.is_active(Collection(name="x", is_archived=False, start_date=today + timedelta(days=1)), today)
    assert not collection_service.is_active(Collection(name="x", is_archived=False, start_date=date(2026, 10, 1), end_date=date(2026, 10, 5)), today)
    assert not collection_service.is_active(Collection(name="x", is_archived=True, start_date=today), today)


def test_category_breakdown_counts_split_lines_and_nets_refunds(db_session, user, account, category):
    fun = Category(user_id=user.id, name="Fun", type="expense", color="#123456")
    db_session.add(fun)
    db_session.commit()
    big = _tx(db_session, user, account, "-100.00", "Costco", date(2026, 7, 1), category)
    db_session.add_all([
        TransactionSplit(transaction_id=big.id, user_id=user.id, category_id=category.id, amount=Decimal("-60.00")),
        TransactionSplit(transaction_id=big.id, user_id=user.id, category_id=fun.id, amount=Decimal("-40.00")),
    ])
    refund = _tx(db_session, user, account, "10.00", "Return", date(2026, 7, 2), fun)
    row = Collection(user_id=user.id, name="Trip", is_archived=False)
    db_session.add(row)
    db_session.commit()
    collection_service.add_transactions(db_session, user.id, row, [big.id, refund.id])
    db_session.commit()

    breakdown = collection_service.category_breakdown(db_session, user.id, row.id)

    assert breakdown == [(category.id, Decimal("60.00")), (fun.id, Decimal("30.00"))]


def test_service_ignores_empty_requests(db_session, user):
    row = Collection(user_id=user.id, name="Trip", is_archived=False)
    db_session.add(row)
    db_session.commit()
    assert collection_service.add_transactions(db_session, user.id, row, []).added == 0
    assert collection_service.remove_transactions(db_session, user.id, row, []) == 0
    assert collection_service.owned_collections(db_session, user.id, []) == []


def test_suggestions_are_empty_when_the_dates_are_reversed(db_session, user):
    row = Collection(user_id=user.id, name="Trip", is_archived=False, start_date=date(2026, 5, 10), end_date=date(2026, 5, 1))
    assert collection_service.suggestions(db_session, user.id, row, date(2026, 5, 20)) == []


# ─── Export ───────────────────────────────────────────────────────────────────
def test_export_includes_collections_and_their_transactions(client, db_session, user, account, auth_headers, today):
    tx = _tx(db_session, user, account, "-10.00", "Gas", today)
    trip = _create(client, auth_headers, name="Ohio trip", budget="100")
    client.post(f"/collections/{trip['id']}/transactions", json={"transaction_ids": [tx.id]}, headers=auth_headers)

    body = json.loads(client.get("/account/export", headers=auth_headers).content)

    assert body["collections"] == [{
        "id": trip["id"], "name": "Ohio trip", "emoji": None, "color": None, "note": None,
        "start_date": None, "end_date": None, "budget": "100.00", "is_archived": False,
        "created_at": body["collections"][0]["created_at"], "transaction_ids": [tx.id],
    }]
