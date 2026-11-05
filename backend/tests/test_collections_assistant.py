"""The assistant's list_collections tool: what each trip or event cost."""

from datetime import timedelta
from decimal import Decimal

from models.database import Transaction
from routers import assistant
from utils.dates import user_today


def _tx(db, user, account, amount, description, day, category=None):
    row = Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id if category else None,
        amount=Decimal(amount), description=description, transaction_date=day,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _create(client, headers, **body):
    response = client.post("/collections/", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_assistant_tool_reports_each_collections_cost(client, db_session, user, account, category, auth_headers):
    today = user_today(user)
    hotel = _tx(db_session, user, account, "-200.00", "Hotel", today, category)
    payback = _tx(db_session, user, account, "50.00", "Payback", today)
    trip = _create(client, auth_headers, name="Ohio trip", start_date=str(today - timedelta(days=1)), budget="500")
    _create(client, auth_headers, name="House move")
    client.post(f"/collections/{trip['id']}/transactions", json={"transaction_ids": [hotel.id, payback.id]}, headers=auth_headers)

    result = assistant.READ_TOOLS["list_collections"](db_session, user, name="ohio")

    assert [c["name"] for c in result["collections"]] == ["Ohio trip"]
    ohio = result["collections"][0]
    assert ohio["spent"] == 200.0 and ohio["money_back"] == 50.0 and ohio["net_cost"] == 150.0
    assert ohio["active"] is True and ohio["budget"] == 500.0 and ohio["transaction_count"] == 2
    assert ohio["top_categories"] == [{"category": "Food", "amount": 200.0}]
    assert len(assistant.READ_TOOLS["list_collections"](db_session, user)["collections"]) == 2
    assert "list_collections" in assistant.QUICK_TOOL_NAMES
    assert any(schema["name"] == "list_collections" for schema in assistant._tool_schemas())
