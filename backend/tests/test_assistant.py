from datetime import date
from decimal import Decimal

from models.database import Transaction
from routers import assistant


def test_category_visual_block_uses_tool_totals_and_scope():
    block = assistant._visual_block_for_tool(
        "spending_by_category",
        {"date_from": "2026-07-01", "date_to": "2026-07-14"},
        [
            {"category": "Food", "total_spent": 75},
            {"category": "Transit", "total_spent": 25},
        ],
        as_of=date(2026, 7, 14),
    )

    assert block["scope"] == "2026-07-01 to 2026-07-14"
    assert block["source"] == "Fintrack ledger"
    assert block["total"] == 100
    assert block["rows"][0]["share"] == 0.75


def test_briefing_is_authenticated_and_ledger_backed(
    client, db_session, user, account, category, auth_headers
):
    db_session.add(
        Transaction(
            user_id=user.id,
            account_id=account.id,
            category_id=category.id,
            amount=Decimal("-42.50"),
            description="Groceries",
            transaction_date=date.today(),
        )
    )
    db_session.commit()

    assert client.get("/assistant/briefing").status_code == 401
    response = client.get("/assistant/briefing", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["as_of"] == date.today().isoformat()
    assert [block["type"] for block in payload["blocks"]] == ["metric_grid", "category_breakdown"]
    category_block = payload["blocks"][1]
    assert category_block["source"] == "Fintrack ledger"
    assert category_block["total"] == 42.5


def test_cashflow_trend_uses_signed_transactions(db_session, user, account):
    db_session.add_all(
        [
            Transaction(user_id=user.id, account_id=account.id, amount=Decimal("100"), transaction_date=date.today()),
            Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-35"), transaction_date=date.today()),
        ]
    )
    db_session.commit()

    result = assistant._t_cashflow_trend(db_session, user, months=1)
    block = assistant._visual_block_for_tool("cashflow_trend", {"months": 1}, result)

    assert result == [{"month": date.today().strftime("%Y-%m"), "income": 100.0, "spending": 35.0, "net": 65.0}]
    assert block["type"] == "cashflow_trend"
    assert block["rows"][0]["value"] == 65.0
