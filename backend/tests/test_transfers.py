"""Transfers between a user's own accounts: balances move exactly, and only theirs.

Written to pin the router's behaviour as it stands (Phase 6 coverage work):
nothing here changes how a transfer is recorded.
"""

from decimal import Decimal

from models.auth import User
from models.database import Account, Transfer
from utils import auth as auth_utils


def _balances(db_session, *accounts):
    db_session.expire_all()
    return [Decimal(str(db_session.get(Account, a.id).balance)) for a in accounts]


def _transfer(client, headers, source, target, amount, day="2026-03-02", note=None):
    body = {"from_account_id": source.id, "to_account_id": target.id, "amount": amount, "transfer_date": day}
    if note is not None:
        body["note"] = note
    return client.post("/transfers/", headers=headers, json=body)


def test_a_transfer_moves_both_balances_by_exactly_the_amount(client, db_session, auth_headers, account, second_account):
    before_from, before_to = _balances(db_session, account, second_account)
    res = _transfer(client, auth_headers, account, second_account, "123.45", note="rainy day")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["amount"] == "123.45" and body["note"] == "rainy day"
    after_from, after_to = _balances(db_session, account, second_account)
    assert after_from == before_from - Decimal("123.45")
    assert after_to == before_to + Decimal("123.45")


def test_cents_never_drift_across_many_transfers(client, db_session, auth_headers, account, second_account):
    before_from, before_to = _balances(db_session, account, second_account)
    for amount in ("0.10", "0.20", "0.30", "0.01"):
        assert _transfer(client, auth_headers, account, second_account, amount).status_code == 201
    after_from, after_to = _balances(db_session, account, second_account)
    assert after_from == before_from - Decimal("0.61")
    assert after_to == before_to + Decimal("0.61")


def test_invalid_transfers_change_nothing(client, db_session, auth_headers, account, second_account):
    before = _balances(db_session, account, second_account)
    assert _transfer(client, auth_headers, account, account, "10").status_code == 400
    assert _transfer(client, auth_headers, account, second_account, "0").status_code == 400
    assert _transfer(client, auth_headers, account, second_account, "-5").status_code == 400
    assert _balances(db_session, account, second_account) == before
    assert db_session.query(Transfer).count() == 0


def test_another_users_account_is_out_of_reach(client, db_session, auth_headers, account):
    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    theirs = Account(user_id=other.id, name="Theirs", type="checking", balance=Decimal("500"))
    db_session.add(theirs)
    db_session.commit()
    before = _balances(db_session, account, theirs)
    assert _transfer(client, auth_headers, account, theirs, "10").status_code == 404
    assert _transfer(client, auth_headers, theirs, account, "10").status_code == 404
    assert _balances(db_session, account, theirs) == before
    assert db_session.query(Transfer).count() == 0


def test_listing_and_reading_are_per_user_and_newest_first(client, db_session, auth_headers, account, second_account):
    older = _transfer(client, auth_headers, account, second_account, "5", day="2026-03-01").json()
    newer = _transfer(client, auth_headers, second_account, account, "7", day="2026-03-09").json()
    listed = client.get("/transfers/", headers=auth_headers).json()
    assert [row["id"] for row in listed] == [newer["id"], older["id"]]
    assert client.get(f"/transfers/{older['id']}", headers=auth_headers).json()["amount"] == "5.00"

    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    other_headers = {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(other.id)})}"}
    assert client.get("/transfers/", headers=other_headers).json() == []
    assert client.get(f"/transfers/{older['id']}", headers=other_headers).status_code == 404
    assert client.delete(f"/transfers/{older['id']}", headers=other_headers).status_code == 404


def test_deleting_a_transfer_puts_both_balances_back(client, db_session, auth_headers, account, second_account):
    before = _balances(db_session, account, second_account)
    created = _transfer(client, auth_headers, account, second_account, "80.08").json()
    assert client.delete(f"/transfers/{created['id']}", headers=auth_headers).status_code == 204
    assert _balances(db_session, account, second_account) == before
    assert client.delete(f"/transfers/{created['id']}", headers=auth_headers).status_code == 404
    assert client.get(f"/transfers/{created['id']}", headers=auth_headers).status_code == 404
