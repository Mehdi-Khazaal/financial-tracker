from datetime import date
from decimal import Decimal

from models.auth import User
from models.database import Account, AssistantConversation, Category, RecurringTransaction, Transaction
from routers import assistant, stocks
from utils import auth as auth_utils


def _create_second_user(db_session):
    user = User(
        email="other@example.com",
        username="other-user",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    headers = {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(user.id)})}"}
    return user, headers


def _create_other_resources(db_session, other_user):
    account = Account(
        user_id=other_user.id,
        name="Other checking",
        type="checking",
        balance=Decimal("900.00"),
        currency="USD",
    )
    category = Category(user_id=other_user.id, name="Other private", type="expense", color="#112233")
    db_session.add_all([account, category])
    db_session.commit()
    db_session.refresh(account)
    db_session.refresh(category)
    return account, category


def _recurring_payload(account_id, category_id=None):
    return {
        "account_id": account_id,
        "category_id": category_id,
        "amount": "-25.00",
        "description": "Monthly service",
        "period": "monthly",
        "next_date": date.today().isoformat(),
        "is_variable": False,
    }


def test_recurring_create_rejects_another_users_account_and_category(
    client, db_session, auth_headers, account
):
    other_user, _ = _create_second_user(db_session)
    other_account, other_category = _create_other_resources(db_session, other_user)

    account_response = client.post(
        "/recurring/", headers=auth_headers, json=_recurring_payload(other_account.id)
    )
    category_response = client.post(
        "/recurring/", headers=auth_headers, json=_recurring_payload(account.id, other_category.id)
    )

    assert account_response.status_code == 404
    assert category_response.status_code == 404
    assert db_session.query(RecurringTransaction).count() == 0


def test_recurring_update_rejects_cross_tenant_references(
    client, db_session, user, auth_headers, account, category
):
    other_user, _ = _create_second_user(db_session)
    other_account, other_category = _create_other_resources(db_session, other_user)
    recurring = RecurringTransaction(
        user_id=user.id,
        account_id=account.id,
        category_id=category.id,
        amount=Decimal("-10.00"),
        description="Valid recurring",
        period="monthly",
        next_date=date.today(),
        is_active=True,
        is_variable=False,
    )
    db_session.add(recurring)
    db_session.commit()
    db_session.refresh(recurring)

    assert client.patch(
        f"/recurring/{recurring.id}", headers=auth_headers, json={"account_id": other_account.id}
    ).status_code == 404
    assert client.patch(
        f"/recurring/{recurring.id}", headers=auth_headers, json={"category_id": other_category.id}
    ).status_code == 404

    db_session.refresh(recurring)
    assert recurring.account_id == account.id
    assert recurring.category_id == category.id


def test_user_processing_skips_tampered_cross_tenant_recurring(
    client, db_session, user, auth_headers
):
    other_user, _ = _create_second_user(db_session)
    other_account, other_category = _create_other_resources(db_session, other_user)
    tampered = RecurringTransaction(
        user_id=user.id,
        account_id=other_account.id,
        category_id=other_category.id,
        amount=Decimal("-50.00"),
        description="Tampered",
        period="monthly",
        next_date=date.today(),
        is_active=True,
        is_variable=False,
    )
    db_session.add(tampered)
    db_session.commit()

    response = client.post("/recurring/process-due", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == []
    assert db_session.query(Transaction).count() == 0
    db_session.refresh(other_account)
    assert Decimal(str(other_account.balance)) == Decimal("900.00")


def test_variable_log_rejects_tampered_cross_tenant_account(
    client, db_session, user, auth_headers
):
    other_user, _ = _create_second_user(db_session)
    other_account, _ = _create_other_resources(db_session, other_user)
    tampered = RecurringTransaction(
        user_id=user.id,
        account_id=other_account.id,
        amount=Decimal("-10.00"),
        description="Tampered variable",
        period="monthly",
        next_date=date.today(),
        is_active=True,
        is_variable=True,
    )
    db_session.add(tampered)
    db_session.commit()
    db_session.refresh(tampered)

    response = client.post(
        f"/recurring/{tampered.id}/log", headers=auth_headers, json={"amount": "-20.00"}
    )

    assert response.status_code == 404
    assert db_session.query(Transaction).count() == 0


def test_cron_requires_header_secret_and_skips_cross_tenant_rows(
    client, db_session, monkeypatch, user, account, category
):
    monkeypatch.setenv("CRON_SECRET", "cron-test-secret")
    other_user, _ = _create_second_user(db_session)
    other_account, _ = _create_other_resources(db_session, other_user)
    valid = RecurringTransaction(
        user_id=user.id,
        account_id=account.id,
        category_id=category.id,
        amount=Decimal("-15.00"),
        description="Valid",
        period="monthly",
        next_date=date.today(),
        is_active=True,
        is_variable=False,
    )
    tampered = RecurringTransaction(
        user_id=user.id,
        account_id=other_account.id,
        amount=Decimal("-500.00"),
        description="Tampered",
        period="monthly",
        next_date=date.today(),
        is_active=True,
        is_variable=False,
    )
    db_session.add_all([valid, tampered])
    db_session.commit()

    query_response = client.post("/cron/process-recurring?secret=cron-test-secret")
    header_response = client.post(
        "/cron/process-recurring", headers={"X-Cron-Secret": "cron-test-secret"}
    )

    assert query_response.status_code == 403
    assert header_response.status_code == 200
    assert header_response.json()["processed"] == 1
    assert db_session.query(Transaction).count() == 1
    db_session.refresh(other_account)
    assert Decimal(str(other_account.balance)) == Decimal("900.00")


def test_assistant_execute_requires_server_pending_action_and_is_one_time(
    client, db_session, user, auth_headers
):
    assistant._pending_actions.clear()
    conversation = AssistantConversation(user_id=user.id, title="Test")
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    payload = {"name": "AI checking", "type": "checking", "balance": 10}
    token = assistant._register_pending_action(user.id, conversation.id, "add_account", payload)
    body = {
        "conversation_id": conversation.id,
        "tool": "add_account",
        "input": payload,
        "action_token": token,
    }

    first = client.post("/assistant/execute", headers=auth_headers, json=body)
    replay = client.post("/assistant/execute", headers=auth_headers, json=body)

    assert first.status_code == 200
    assert replay.status_code == 400
    assert db_session.query(Account).filter(Account.user_id == user.id, Account.name == "AI checking").count() == 1


def test_assistant_pending_action_cannot_cross_users(
    client, db_session, user, auth_headers
):
    assistant._pending_actions.clear()
    other_user, other_headers = _create_second_user(db_session)
    conversation = AssistantConversation(user_id=user.id, title="Test")
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    payload = {"name": "Private savings", "type": "savings", "balance": 0}
    token = assistant._register_pending_action(user.id, conversation.id, "add_account", payload)
    body = {
        "conversation_id": conversation.id,
        "tool": "add_account",
        "input": payload,
        "action_token": token,
    }

    cross_user = client.post("/assistant/execute", headers=other_headers, json=body)
    owner = client.post("/assistant/execute", headers=auth_headers, json=body)

    assert cross_user.status_code == 404
    assert owner.status_code == 200
    assert db_session.query(Account).filter(Account.user_id == other_user.id).count() == 0


def test_assistant_rejects_oversized_chat_and_unsigned_execute(client, auth_headers):
    chat = client.post("/assistant/chat", headers=auth_headers, json={"message": "x" * 4001})
    execute = client.post(
        "/assistant/execute",
        headers=auth_headers,
        json={"tool": "add_account", "input": {"name": "No token", "type": "checking"}},
    )

    assert chat.status_code == 422
    assert execute.status_code == 422


def test_stock_lookup_requires_auth_and_rejects_invalid_symbols(client, auth_headers):
    assert client.get("/stocks/AAPL").status_code == 401
    response = client.get("/stocks/AAPL%24", headers=auth_headers)
    assert response.status_code == 422


def test_stock_cache_is_bounded():
    stocks._price_cache.clear()
    for index in range(stocks.PRICE_CACHE_MAX_ENTRIES + 10):
        stocks._store_cached_quote(f"SYM{index}", {"price": index})

    assert len(stocks._price_cache) == stocks.PRICE_CACHE_MAX_ENTRIES
    assert "SYM0" not in stocks._price_cache
