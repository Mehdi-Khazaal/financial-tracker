"""Categorization rules: matching, precedence, preview, retroactive apply, sync path, isolation."""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Category, CategorizationRule, Transaction
from routers.plaid_router import PlaidItem
from routers import assistant, plaid_router
from services import categorization_rules as rules
from services import merchants, user_preferences
from services.ledger import LedgerService
from services.transaction_enrichment import (
    SOURCE_MERCHANT_HISTORY,
    SOURCE_RULE,
    SOURCE_USER,
    enrich_transaction_input,
    resolve_transaction_merchant,
    suggest_transaction_category,
)
from utils import auth as auth_utils
from utils.secret_box import encrypt_secret


# ─── Fixtures ─────────────────────────────────────────────────────────────────
@pytest.fixture
def subscriptions(db_session, user):
    row = Category(user_id=user.id, name="Subscriptions", type="expense", color="#6366f1")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _rule(db, user, category, pattern, *, field="description", match_type="contains", priority=100, active=True):
    row = CategorizationRule(
        user_id=user.id, category_id=category.id, field=field, match_type=match_type,
        pattern=pattern, priority=priority, is_active=active, applied_count=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _tx(db, user, account, description, *, category=None, source=None, amount="-10.00", day=date(2026, 3, 1)):
    row = Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id if category else None,
        category_source=source, amount=Decimal(amount), description=description,
        merchant_key=merchants.merchant_key(description), transaction_date=day,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ─── Matching ─────────────────────────────────────────────────────────────────
def test_contains_is_case_insensitive_substring():
    rule = rules.compile_rule(category_id=1, field="description", match_type="contains", pattern="netflix")
    assert rule.matches("NETFLIX.COM 866-579-7172", "netflix")
    assert not rule.matches("Spotify", "spotify")
    assert not rule.matches(None, None)


def test_regex_searches_anywhere_ignoring_case():
    rule = rules.compile_rule(category_id=1, field="description", match_type="regex", pattern=r"^(uber|lyft)\b")
    assert rule.matches("UBER *TRIP HELP.UBER.COM", None)
    assert not rule.matches("SUPER UBER STORE", None)


def test_merchant_field_compares_normalised_keys():
    rule = rules.compile_rule(category_id=1, field="merchant", match_type="contains", pattern="Netflix.com")
    assert rule.matches("anything", merchants.merchant_key("NETFLIX 800-585-3000"))
    assert not rule.matches("anything", None)


def test_invalid_rules_are_rejected():
    with pytest.raises(rules.InvalidRule):
        rules.validate("description", "regex", "(unclosed")
    with pytest.raises(rules.InvalidRule):
        rules.validate("amount", "contains", "x")
    with pytest.raises(rules.InvalidRule):
        rules.validate("description", "contains", "   ")
    with pytest.raises(rules.InvalidRule):
        rules.validate("description", "contains", "x" * (rules.MAX_PATTERN_LENGTH + 1))


# ─── Precedence ───────────────────────────────────────────────────────────────
def test_rule_beats_merchant_history(db_session, user, account, category, subscriptions):
    for day in (1, 2):
        _tx(db_session, user, account, "NETFLIX", category=category, source=SOURCE_USER, day=date(2026, 1, day))
    _rule(db_session, user, subscriptions, "netflix")
    identity = resolve_transaction_merchant("NETFLIX.COM")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)
    assert (suggested, source) == (subscriptions.id, SOURCE_RULE)


def test_lowest_priority_number_wins_then_id(db_session, user, account, category, subscriptions):
    _rule(db_session, user, category, "net", priority=200)
    _rule(db_session, user, subscriptions, "netflix", priority=10)
    identity = resolve_transaction_merchant("NETFLIX")
    assert suggest_transaction_category(db_session, user.id, identity)[0] == subscriptions.id


def test_inactive_rules_do_not_fire(db_session, user, account, category):
    _rule(db_session, user, category, "netflix", active=False)
    identity = resolve_transaction_merchant("NETFLIX")
    assert suggest_transaction_category(db_session, user.id, identity) == (None, None)


def test_rules_run_even_when_automatic_categorization_is_off(db_session, user, account, category, subscriptions):
    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": False})
    db_session.commit()
    for day in (1, 2):
        _tx(db_session, user, account, "SPOTIFY", category=category, day=date(2026, 1, day))
    _rule(db_session, user, subscriptions, "netflix")
    # History-only merchant: the preference is off, so no guess.
    assert suggest_transaction_category(db_session, user.id, resolve_transaction_merchant("SPOTIFY")) == (None, None)
    # Rule: fires regardless.
    assert suggest_transaction_category(db_session, user.id, resolve_transaction_merchant("NETFLIX"))[1] == SOURCE_RULE


def test_explicit_category_still_wins_over_a_rule(db_session, user, account, category, subscriptions):
    _rule(db_session, user, subscriptions, "netflix")
    enriched = enrich_transaction_input(db_session, user.id, {"description": "NETFLIX", "category_id": category.id})
    assert enriched["category_id"] == category.id
    assert enriched["category_source"] == SOURCE_USER


def test_manual_entry_without_a_category_is_filed_by_the_rule(db_session, user, account, subscriptions):
    rule = _rule(db_session, user, subscriptions, "netflix")
    created = LedgerService(db_session).create_transaction(user.id, {
        "account_id": account.id, "amount": Decimal("-15.99"), "description": "NETFLIX.COM", "transaction_date": date(2026, 3, 2),
    })
    assert created.category_id == subscriptions.id
    assert created.category_source == SOURCE_RULE
    db_session.refresh(rule)
    assert rule.applied_count == 1


def test_rules_are_cached_per_session_and_invalidated(db_session, user, subscriptions, category):
    _rule(db_session, user, subscriptions, "netflix")
    assert len(rules.active_rules(db_session, user.id)) == 1
    _rule(db_session, user, category, "spotify")
    # Same session, cached: still one until invalidated.
    assert len(rules.active_rules(db_session, user.id)) == 1
    rules.invalidate(db_session, user.id)
    assert len(rules.active_rules(db_session, user.id)) == 2


# ─── Plaid sync path ──────────────────────────────────────────────────────────
PLAID_ACCOUNT_ID = "plaid-acct-1"


def _plaid_tx(transaction_id, name):
    return {
        "transaction_id": transaction_id, "account_id": PLAID_ACCOUNT_ID, "amount": 15.99, "date": "2026-03-02",
        "name": name, "merchant_name": None, "merchant_entity_id": None, "payment_channel": "online",
        "iso_currency_code": "USD", "personal_finance_category": {"primary": "ENTERTAINMENT", "detailed": "X"}, "pending": False,
    }


def test_plaid_import_is_filed_by_a_rule_before_pfc(db_session, user, account, subscriptions, monkeypatch):
    account.plaid_account_id = PLAID_ACCOUNT_ID
    item = PlaidItem(user_id=user.id, access_token=encrypt_secret("t"), item_id="item-1", institution_name="Bank")
    db_session.add(item)
    # An "Entertainment" category exists, so PFC alone would file it there.
    db_session.add(Category(user_id=user.id, name="Entertainment", type="expense", color="#fff"))
    db_session.commit()
    rule = _rule(db_session, user, subscriptions, "netflix")

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{"account_id": PLAID_ACCOUNT_ID, "balances": {"current": 100.0}, "type": "depository"}]}
        if path == "/transactions/sync":
            return {"added": [_plaid_tx("tx-1", "NETFLIX.COM 866-579-7172"), _plaid_tx("tx-2", "AMC THEATRES")], "modified": [], "removed": [], "next_cursor": "c", "has_more": False}
        raise AssertionError(path)

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    plaid_router._sync_item(db_session, item, user.id)

    netflix = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    amc = db_session.query(Transaction).filter_by(plaid_tx_id="tx-2").one()
    assert (netflix.category_id, netflix.category_source) == (subscriptions.id, SOURCE_RULE)
    assert amc.category_source != SOURCE_RULE
    db_session.refresh(rule)
    assert rule.applied_count == 1


# ─── API: CRUD, preview, apply, isolation ─────────────────────────────────────
def test_crud_and_validation(client, db_session, user, auth_headers, subscriptions):
    created = client.post("/rules/", headers=auth_headers, json={"category_id": subscriptions.id, "pattern": " netflix ", "priority": 5})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["pattern"] == "netflix" and body["field"] == "description" and body["match_type"] == "contains"

    listed = client.get("/rules/", headers=auth_headers)
    assert listed.status_code == 200 and len(listed.json()) == 1 and listed.headers["etag"]

    assert client.post("/rules/", headers=auth_headers, json={"category_id": subscriptions.id, "pattern": "(", "match_type": "regex"}).status_code == 422
    assert client.post("/rules/", headers=auth_headers, json={"category_id": subscriptions.id, "pattern": "x", "field": "amount"}).status_code == 422
    assert client.post("/rules/", headers=auth_headers, json={"category_id": 999999, "pattern": "x"}).status_code == 404

    updated = client.put(f"/rules/{body['id']}", headers=auth_headers, json={"is_active": False, "priority": 1})
    assert updated.status_code == 200 and updated.json()["is_active"] is False and updated.json()["priority"] == 1
    assert client.put(f"/rules/{body['id']}", headers=auth_headers, json={"match_type": "regex", "pattern": "["}).status_code == 422

    assert client.delete(f"/rules/{body['id']}", headers=auth_headers).status_code == 204
    assert client.get("/rules/", headers=auth_headers).json() == []


def test_preview_counts_changeable_and_protected_rows(client, db_session, user, account, category, subscriptions, auth_headers):
    _tx(db_session, user, account, "NETFLIX.COM")                                              # uncategorised → would change
    _tx(db_session, user, account, "Netflix", category=category, source=SOURCE_MERCHANT_HISTORY)  # inferred → would change
    _tx(db_session, user, account, "NETFLIX INC", category=category, source=SOURCE_USER)       # hand-filed → protected
    _tx(db_session, user, account, "NETFLIX", category=subscriptions, source=SOURCE_USER)      # already there → neither
    _tx(db_session, user, account, "SPOTIFY")

    res = client.post("/rules/preview", headers=auth_headers, json={"category_id": subscriptions.id, "pattern": "netflix"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["matched"], body["would_change"], body["protected"]) == (4, 2, 1)
    assert len(body["sample"]) == 4
    assert all(isinstance(row["amount"], str) for row in body["sample"])
    # Nothing was written.
    assert db_session.query(Transaction).filter(Transaction.category_source == SOURCE_RULE).count() == 0


def test_apply_is_idempotent_and_never_touches_user_choices(client, db_session, user, account, category, subscriptions, auth_headers):
    plain = _tx(db_session, user, account, "NETFLIX.COM")
    inferred = _tx(db_session, user, account, "Netflix", category=category, source=SOURCE_MERCHANT_HISTORY)
    chosen = _tx(db_session, user, account, "NETFLIX INC", category=category, source=SOURCE_USER)
    balance_before = account.balance
    rule = client.post("/rules/", headers=auth_headers, json={"category_id": subscriptions.id, "pattern": "netflix"}).json()

    first = client.post(f"/rules/{rule['id']}/apply", headers=auth_headers)
    assert first.status_code == 200 and first.json()["changed"] == 2
    second = client.post(f"/rules/{rule['id']}/apply", headers=auth_headers)
    assert second.json()["changed"] == 0

    db_session.expire_all()
    assert (plain.category_id, plain.category_source) == (subscriptions.id, SOURCE_RULE)
    assert (inferred.category_id, inferred.category_source) == (subscriptions.id, SOURCE_RULE)
    assert (chosen.category_id, chosen.category_source) == (category.id, SOURCE_USER)
    assert account.balance == balance_before
    assert client.get("/rules/", headers=auth_headers).json()[0]["applied_count"] == 2


def test_rules_and_transactions_are_per_user(client, db_session, user, account, subscriptions, auth_headers):
    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    other_cat = Category(user_id=other.id, name="Theirs", type="expense", color="#fff")
    db_session.add(other_cat)
    db_session.commit()
    other_rule = _rule(db_session, other, other_cat, "netflix")
    _tx(db_session, user, account, "NETFLIX")

    # Their rule does not fire for my transaction.
    assert suggest_transaction_category(db_session, user.id, resolve_transaction_merchant("NETFLIX")) == (None, None)
    # I cannot see, edit, apply or delete their rule, nor use their category.
    assert client.get("/rules/", headers=auth_headers).json() == []
    assert client.put(f"/rules/{other_rule.id}", headers=auth_headers, json={"is_active": False}).status_code == 404
    assert client.post(f"/rules/{other_rule.id}/apply", headers=auth_headers).status_code == 404
    assert client.delete(f"/rules/{other_rule.id}", headers=auth_headers).status_code == 404
    assert client.post("/rules/", headers=auth_headers, json={"category_id": other_cat.id, "pattern": "x"}).status_code == 404
    # Their preview never sees my rows.
    other_headers = {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(other.id)})}"}
    assert client.post("/rules/preview", headers=other_headers, json={"category_id": other_cat.id, "pattern": "netflix"}).json()["matched"] == 0


def test_deleting_the_category_removes_its_rules(client, db_session, user, subscriptions, auth_headers):
    _rule(db_session, user, subscriptions, "netflix")
    assert client.delete(f"/categories/{subscriptions.id}", headers=auth_headers).status_code == 204
    db_session.expire_all()
    assert db_session.query(CategorizationRule).count() == 0


def test_assistant_list_rules_tool(db_session, user, subscriptions):
    _rule(db_session, user, subscriptions, "netflix", priority=3)
    result = assistant.READ_TOOLS["list_rules"](db_session, user)
    assert result["rules"][0]["category"] == "Subscriptions"
    assert result["rules"][0]["when"] == 'description contains "netflix"'
    assert "list_rules" in assistant.QUICK_TOOL_NAMES
    assert any(schema["name"] == "list_rules" for schema in assistant._tool_schemas())
