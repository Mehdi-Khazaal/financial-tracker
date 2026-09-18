"""CSV import: parsing, mapping, duplicates, posting through the ledger, undo, isolation."""

from datetime import date
from decimal import Decimal

from models.auth import User
from models.database import Account, Category, Transaction
from services import csv_import
from utils import auth as auth_utils


SIMPLE = "Date,Description,Amount\n2026-03-01,NETFLIX.COM,-15.99\n2026-03-02,Salary,3000\n"


# ─── Parsing helpers ──────────────────────────────────────────────────────────
def test_amounts_in_every_common_shape():
    assert csv_import.parse_amount("-12.50") == Decimal("-12.50")
    assert csv_import.parse_amount("(12.50)") == Decimal("-12.50")
    assert csv_import.parse_amount("$1,200.00") == Decimal("1200.00")
    assert csv_import.parse_amount("1.234,56") == Decimal("1234.56")
    assert csv_import.parse_amount("12,50") == Decimal("12.50")
    assert csv_import.parse_amount("abc") is None
    assert csv_import.parse_amount("") is None


def test_dates_in_every_common_shape():
    assert csv_import.parse_date("2026-03-01") == date(2026, 3, 1)
    assert csv_import.parse_date("2026-03-01T10:00:00Z") == date(2026, 3, 1)
    assert csv_import.parse_date("03/04/2026") == date(2026, 3, 4)          # auto → MDY first
    assert csv_import.parse_date("03/04/2026", "dmy") == date(2026, 4, 3)
    assert csv_import.parse_date("Mar 4, 2026") == date(2026, 3, 4)
    assert csv_import.parse_date("not a date") is None


def test_mapping_suggestions_and_debit_credit_precedence():
    assert csv_import.suggest_mapping(["Posted Date", "Payee", "Amount", "Category"]) == {
        "date": "Posted Date", "amount": "Amount", "description": "Payee", "category": "Category", "debit": None, "credit": None,
    }
    m = csv_import.suggest_mapping(["Date", "Memo", "Withdrawal", "Deposit"])
    assert (m["debit"], m["credit"], m["amount"], m["description"]) == ("Withdrawal", "Deposit", None, "Memo")


def test_parse_csv_sniffs_delimiters_and_rejects_bad_files():
    headers, rows = csv_import.parse_csv("﻿Date;Amount\n2026-03-01;-1\n\n")
    assert headers == ["Date", "Amount"] and rows == [{"Date": "2026-03-01", "Amount": "-1"}]
    for bad in ("", "Date,Amount\n", "x" * (csv_import.MAX_TEXT_BYTES + 1)):
        try:
            csv_import.parse_csv(bad)
        except csv_import.ImportError_:
            continue
        raise AssertionError(f"accepted: {bad[:20]!r}")


# ─── Preview ──────────────────────────────────────────────────────────────────
def test_preview_normalises_flags_and_writes_nothing(client, db_session, user, account, category, auth_headers):
    db_session.add(Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-15.99"), description="Netflix", merchant_key="netflix", transaction_date=date(2026, 3, 1)))
    db_session.commit()
    text = (
        "Date,Description,Amount,Category\n"
        "2026-03-01,NETFLIX.COM 866-579-7172,-15.99,Food\n"   # duplicate of the existing row
        "2026-03-02,Salary,3000,\n"
        "2026-03-02,Salary,3000,\n"                           # duplicate within the file
        "bad date,Coffee,-4.50,\n"
        "2026-03-03,Fee,abc,\n"
    )
    res = client.post("/transactions/import/preview", headers=auth_headers, json={"account_id": account.id, "text": text})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mapping"] == {"date": "Date", "amount": "Amount", "description": "Description", "category": "Category", "debit": None, "credit": None}
    assert (body["total"], body["valid"], body["invalid"], body["duplicates"]) == (5, 3, 2, 2)
    rows = body["sample"]
    assert rows[0]["duplicate"] is True and rows[0]["category_id"] == category.id and rows[0]["amount"] == "-15.99"
    assert rows[2]["duplicate"] is True
    assert rows[3]["errors"] == ["unreadable date"] and rows[4]["errors"] == ["unreadable amount"]
    assert db_session.query(Transaction).count() == 1


def test_preview_honours_mapping_date_format_flip_and_debit_credit(client, db_session, user, account, auth_headers):
    text = "When,Memo,Out,In\n03/04/2026,Coffee,4.50,\n03/05/2026,Refund,,4.50\n"
    res = client.post("/transactions/import/preview", headers=auth_headers, json={
        "account_id": account.id, "text": text, "date_format": "dmy",
        "mapping": {"date": "When", "description": "Memo", "debit": "Out", "credit": "In"},
    })
    assert res.status_code == 200, res.text
    rows = res.json()["sample"]
    assert rows[0]["date"] == "2026-04-03" and rows[0]["amount"] == "-4.50"
    assert rows[1]["amount"] == "4.50"

    flipped = client.post("/transactions/import/preview", headers=auth_headers, json={
        "account_id": account.id, "text": "Date,Description,Amount\n2026-03-01,Coffee,4.50\n", "flip_sign": True,
    }).json()
    assert flipped["sample"][0]["amount"] == "-4.50"

    assert client.post("/transactions/import/preview", headers=auth_headers, json={
        "account_id": account.id, "text": SIMPLE, "mapping": {"date": "Nope"},
    }).status_code == 422
    assert client.post("/transactions/import/preview", headers=auth_headers, json={
        "account_id": account.id, "text": "Description\nCoffee\n",
    }).status_code == 422


# ─── Import ───────────────────────────────────────────────────────────────────
def test_import_posts_through_the_ledger_skips_duplicates_and_is_undoable(client, db_session, user, account, auth_headers):
    balance_before = Decimal(str(account.balance))
    res = client.post("/transactions/import", headers=auth_headers, json={"account_id": account.id, "text": SIMPLE})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["created"] == 2 and body["skipped_duplicates"] == 0
    batch_id = body["batch_id"]

    db_session.expire_all()
    rows = db_session.query(Transaction).filter_by(import_batch_id=batch_id).order_by(Transaction.transaction_date).all()
    assert [(r.description, r.amount) for r in rows] == [("NETFLIX.COM", Decimal("-15.99")), ("Salary", Decimal("3000.00"))]
    assert rows[0].merchant_key == "netflix"  # enriched like any other write
    assert Decimal(str(account.balance)) == balance_before + Decimal("2984.01")

    # Same file again: everything is now a duplicate.
    again = client.post("/transactions/import", headers=auth_headers, json={"account_id": account.id, "text": SIMPLE}).json()
    assert again["created"] == 0 and again["skipped_duplicates"] == 2
    db_session.expire_all()
    assert Decimal(str(account.balance)) == balance_before + Decimal("2984.01")

    # Undo puts the balance back and removes only that batch.
    undone = client.delete(f"/transactions/import/{batch_id}", headers=auth_headers)
    assert undone.status_code == 200 and undone.json()["removed"] == 2
    db_session.expire_all()
    assert Decimal(str(account.balance)) == balance_before
    assert db_session.query(Transaction).count() == 0
    assert client.delete(f"/transactions/import/{batch_id}", headers=auth_headers).status_code == 404


def test_import_with_a_rule_and_a_category_column(client, db_session, user, account, category, auth_headers):
    from models.database import CategorizationRule
    subs = Category(user_id=user.id, name="Subscriptions", type="expense", color="#fff")
    db_session.add(subs)
    db_session.commit()
    db_session.add(CategorizationRule(user_id=user.id, category_id=subs.id, field="description", match_type="contains", pattern="netflix", priority=1, is_active=True, applied_count=0))
    db_session.commit()
    text = "Date,Description,Amount,Category\n2026-03-01,NETFLIX,-15.99,\n2026-03-02,Market,-20,food\n2026-03-03,Unknown,-1,Nope\n"
    res = client.post("/transactions/import", headers=auth_headers, json={"account_id": account.id, "text": text})
    assert res.status_code == 201, res.text
    db_session.expire_all()
    by_desc = {t.description: t for t in db_session.query(Transaction).all()}
    assert by_desc["NETFLIX"].category_id == subs.id and by_desc["NETFLIX"].category_source == "rule"
    assert by_desc["Market"].category_id == category.id and by_desc["Market"].category_source == "user"
    assert by_desc["Unknown"].category_id is None  # an unknown name is never auto-created


def test_import_is_idempotent_under_the_same_key(client, db_session, user, account, auth_headers):
    headers = {**auth_headers, "Idempotency-Key": "csv-once"}
    first = client.post("/transactions/import", headers=headers, json={"account_id": account.id, "text": SIMPLE})
    second = client.post("/transactions/import", headers=headers, json={"account_id": account.id, "text": SIMPLE})
    assert first.status_code == 201 and second.status_code == 201
    assert first.json() == second.json()
    assert db_session.query(Transaction).count() == 2


def test_import_never_reaches_another_users_account(client, db_session, user, auth_headers):
    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    theirs = Account(user_id=other.id, name="Theirs", type="checking", balance=Decimal("0"))
    db_session.add(theirs)
    db_session.commit()
    assert client.post("/transactions/import/preview", headers=auth_headers, json={"account_id": theirs.id, "text": SIMPLE}).status_code == 404
    assert client.post("/transactions/import", headers=auth_headers, json={"account_id": theirs.id, "text": SIMPLE}).status_code == 404
    assert db_session.query(Transaction).count() == 0


def test_server_csv_export_honours_the_list_filters(client, db_session, user, account, category, auth_headers):
    db_session.add_all([
        Transaction(user_id=user.id, account_id=account.id, category_id=category.id, amount=Decimal("-15.99"), description="NETFLIX", transaction_date=date(2026, 3, 1)),
        Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-4.50"), description="=HYPERLINK(evil)", transaction_date=date(2026, 3, 2)),
        Transaction(user_id=user.id, account_id=account.id, amount=Decimal("3000"), description="Salary", transaction_date=date(2026, 4, 1)),
    ])
    db_session.commit()

    def lines(params):
        res = client.get("/account/export/transactions.csv", headers=auth_headers, params=params)
        assert res.status_code == 200
        return [line for line in res.text.lstrip("﻿").splitlines()[1:] if line]

    assert len(lines({})) == 3
    assert len(lines({"date_from": "2026-03-01", "date_to": "2026-03-31"})) == 2
    assert [l.split(",")[4] for l in lines({"search": "netflix"})] == ["NETFLIX"]
    only_loose = lines({"uncategorized": "true", "date_to": "2026-03-31"})
    assert len(only_loose) == 1 and "'=HYPERLINK(evil)" in only_loose[0]  # formula neutralised
    assert len(lines({"category_id": category.id})) == 1
