"""Assistant upgrades: confirmed budget and rule writes, alert awareness."""

from datetime import date
from decimal import Decimal

import pytest

from models.database import Account, Budget, Category, CategorizationRule, Transaction
from routers import assistant
from routers.assistant.schemas import _action_summary
from services import user_preferences


@pytest.fixture
def groceries(db_session, user):
    row = Category(user_id=user.id, name="Groceries", type="expense", color="#fff")
    db_session.add(row)
    db_session.commit()
    return row


def _run(client, db_session, user, headers, tool, payload):
    token = assistant._register_pending_action(db_session, user.id, None, tool, payload)
    return client.post("/assistant/execute", headers=headers, json={"tool": tool, "input": payload, "action_token": token})


def test_the_new_writes_are_confirm_only_and_the_new_read_is_quick():
    names = {schema["name"] for schema in assistant._tool_schemas()}
    assert {"set_budget", "add_rule", "get_alert_settings"} <= names
    assert {"set_budget", "add_rule"} <= assistant.WRITE_TOOLS
    assert not ({"set_budget", "add_rule"} & set(assistant.READ_TOOLS))
    assert not ({"set_budget", "add_rule"} & set(assistant.QUICK_TOOL_NAMES))
    assert "get_alert_settings" in assistant.QUICK_TOOL_NAMES


def test_summaries_say_exactly_what_will_happen():
    assert _action_summary("set_budget", {"category": "Groceries", "amount": 400, "rollover": True}) == 'Budget 400 a month for "Groceries" with rollover'
    assert _action_summary("add_rule", {"pattern": "netflix", "category": "Subscriptions", "apply_to_past": True}) == (
        'File transactions whose description contains "netflix" under "Subscriptions", and file matching past transactions'
    )


def test_set_budget_creates_then_updates_with_exact_money(client, db_session, user, auth_headers, groceries):
    first = _run(client, db_session, user, auth_headers, "set_budget", {"category": "groceries", "amount": 400.1})
    assert first.status_code == 200, first.text
    assert first.json()["message"] == "Budget set: $400.10 a month for Groceries."
    budget = db_session.query(Budget).one()
    assert budget.amount == Decimal("400.10") and budget.rollover is False and budget.starts_on.day == 1

    second = _run(client, db_session, user, auth_headers, "set_budget", {"category": "Groceries", "amount": "450", "rollover": True})
    assert second.json()["message"] == "Budget updated: $450.00 a month for Groceries."
    db_session.expire_all()
    assert db_session.query(Budget).count() == 1
    assert db_session.query(Budget).one().rollover is True


def test_set_budget_refuses_what_it_cannot_do(client, db_session, user, auth_headers, groceries):
    db_session.add(Category(user_id=user.id, name="Salary", type="income", color="#fff"))
    db_session.commit()
    assert _run(client, db_session, user, auth_headers, "set_budget", {"category": "Salary", "amount": 100}).status_code == 404
    assert _run(client, db_session, user, auth_headers, "set_budget", {"category": "Nope", "amount": 100}).status_code == 404
    assert _run(client, db_session, user, auth_headers, "set_budget", {"category": "Groceries", "amount": 0}).status_code == 400
    assert db_session.query(Budget).count() == 0


def test_add_rule_files_the_future_and_optionally_the_past(client, db_session, user, account, auth_headers, groceries):
    db_session.add_all([
        Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-40"), description="WHOLE FOODS #12", transaction_date=date(2026, 3, 1)),
        Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-10"), description="Whole Foods", category_source="user",
                    category_id=None, transaction_date=date(2026, 3, 2)),
    ])
    db_session.commit()
    res = _run(client, db_session, user, auth_headers, "add_rule", {"pattern": "whole foods", "category": "Groceries", "apply_to_past": True})
    assert res.status_code == 200, res.text
    assert res.json()["message"] == 'Rule added: "whole foods" → Groceries. 2 past transactions filed.'
    rule = db_session.query(CategorizationRule).one()
    assert (rule.pattern, rule.match_type, rule.applied_count) == ("whole foods", "contains", 2)

    bad = _run(client, db_session, user, auth_headers, "add_rule", {"pattern": "   ", "category": "Groceries"})
    assert bad.status_code == 400
    unknown = _run(client, db_session, user, auth_headers, "add_rule", {"pattern": "x", "category": "Nope"})
    assert unknown.status_code == 404


def test_alert_settings_report_flags_and_low_accounts(db_session, user, account):
    account.balance = Decimal("20.00")
    db_session.add(Account(user_id=user.id, name="Card", type="credit_card", balance=Decimal("-500")))
    user_preferences.upsert(db_session, user.id, {"low_balance_alerts_enabled": True, "low_balance_threshold": Decimal("50")})
    db_session.commit()
    result = assistant.READ_TOOLS["get_alert_settings"](db_session, user)
    assert result["low_balance_alerts"] is True and result["bill_reminders"] is True
    assert result["low_balance_threshold"] == 50.0
    assert result["accounts_below_threshold"] == [{"account": account.name, "balance": 20.0}]


def test_the_prompt_offers_the_new_writes_and_stays_byte_stable(db_session, user):
    from models.auth import User
    from routers.assistant.prompt import _build_system_blocks
    from utils import auth as auth_utils

    other = User(email="p@example.com", username="p", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    mine, theirs = _build_system_blocks(db_session, user)[0], _build_system_blocks(db_session, other)[0]
    assert mine == theirs  # the cached persona block carries nothing per user
    assert "`set_budget`" in mine["text"] and "`add_rule`" in mine["text"]


def test_every_write_tool_has_a_confirmation_card_label():
    """The Assistant page names each confirmation card; a new write tool without
    a label would render a bare tool id to the person being asked to confirm."""
    from pathlib import Path

    page = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "Assistant.tsx").read_text(encoding="utf-8")
    labels = page[page.index("const ACTION_LABELS"):page.index("};", page.index("const ACTION_LABELS"))]
    missing = [tool for tool in sorted(assistant.WRITE_TOOLS) if f"{tool}:" not in labels]
    assert missing == []
