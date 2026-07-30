from datetime import date, timedelta
from decimal import Decimal
import sys
from types import SimpleNamespace

from models.database import (
    Asset,
    AssistantConversation,
    RecurringTransaction,
    SavingsGoal,
    Transaction,
)
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
    # Dates resolve in the user's zone, not the server's, so compare against the
    # same helper the endpoint uses rather than the test machine's clock.
    assert payload["as_of"] == assistant._user_today(user).isoformat()
    assert [block["type"] for block in payload["blocks"]] == ["metric_grid", "category_breakdown"]
    category_block = payload["blocks"][1]
    assert category_block["source"] == "Fintrack ledger"
    assert category_block["total"] == 42.5


def test_briefing_dates_in_reported_timezone_not_server_utc(
    client, db_session, user, auth_headers
):
    """The server runs in UTC; "today" must follow the user across the dateline.

    Kiritimati is UTC+14 and Niue is UTC-11, so for any instant the two are on
    different calendar days. That makes this independent of when it runs.
    """
    ahead = client.get(
        "/assistant/briefing", headers=auth_headers, params={"tz": "Pacific/Kiritimati"}
    )
    behind = client.get(
        "/assistant/briefing", headers=auth_headers, params={"tz": "Pacific/Niue"}
    )

    assert ahead.status_code == 200 and behind.status_code == 200
    assert ahead.json()["as_of"] != behind.json()["as_of"]

    # The zone is remembered, so later turns and the chat prompt agree with it.
    db_session.refresh(user)
    assert user.timezone == "Pacific/Niue"


def test_briefing_ignores_a_bogus_timezone(client, db_session, user, auth_headers):
    response = client.get(
        "/assistant/briefing", headers=auth_headers, params={"tz": "Mars/Olympus_Mons"}
    )

    assert response.status_code == 200
    db_session.refresh(user)
    assert user.timezone is None


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


def test_failed_new_chat_does_not_leave_empty_conversation(
    client,
    db_session,
    auth_headers,
    monkeypatch,
):
    class FakeAPIError(Exception):
        pass

    class FailingMessages:
        # The chat loop streams, so the failure has to surface from `stream`.
        def stream(self, **_kwargs):
            raise FakeAPIError("provider unavailable")

    class FailingAnthropic:
        def __init__(self, **_kwargs):
            self.messages = FailingMessages()

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setitem(
        sys.modules,
        "anthropic",
        SimpleNamespace(Anthropic=FailingAnthropic, APIError=FakeAPIError),
    )

    response = client.post(
        "/assistant/chat",
        headers=auth_headers,
        json={"message": "Break down my balances"},
    )

    assert response.status_code == 502
    assert db_session.query(AssistantConversation).count() == 0


# ─── Analytical tools ────────────────────────────────────────────────────────
def _seed_months(db_session, user, account, *, income, spending, months=4):
    """Write income/spending into each of the last `months` complete months."""
    anchor = assistant._month_floor(assistant._user_today(user))
    for offset in range(1, months + 1):
        month = assistant._add_months(anchor, -offset)
        db_session.add_all(
            [
                Transaction(
                    user_id=user.id, account_id=account.id,
                    amount=Decimal(income), transaction_date=month,
                ),
                Transaction(
                    user_id=user.id, account_id=account.id,
                    amount=Decimal(spending), transaction_date=month + timedelta(days=5),
                ),
            ]
        )
    db_session.commit()


def test_monthly_flows_excludes_the_partial_current_month(db_session, user, account):
    """A partial month would drag every average down and fake a downtrend."""
    today = assistant._user_today(user)
    db_session.add(
        Transaction(
            user_id=user.id, account_id=account.id,
            amount=Decimal("-999"), transaction_date=today,
        )
    )
    _seed_months(db_session, user, account, income="3000", spending="-2000", months=3)

    flows = assistant._monthly_flows(db_session, user, months=3, today=today)

    assert today.strftime("%Y-%m") not in [f["month"] for f in flows]
    assert all(f["spending"] == Decimal("2000") for f in flows)


def test_financial_health_computes_savings_rate_and_runway(db_session, user, account):
    _seed_months(db_session, user, account, income="4000", spending="-3000")

    health = assistant._t_financial_health(db_session, user)

    assert health["avg_monthly_income"] == 4000.0
    assert health["avg_monthly_spending"] == 3000.0
    assert health["avg_monthly_surplus"] == 1000.0
    assert health["savings_rate_pct"] == 25.0
    # Account fixture balance / 3000 of monthly spending.
    assert health["emergency_fund_months"] is not None
    assert health["as_of"] == assistant._user_today(user).isoformat()


def test_project_savings_goals_flags_an_unreachable_deadline(db_session, user, account):
    _seed_months(db_session, user, account, income="4000", spending="-3900")
    goal = SavingsGoal(
        user_id=user.id,
        name="Down payment",
        target_amount=Decimal("12000"),
        deadline=assistant._user_today(user) + timedelta(days=90),
    )
    db_session.add(goal)
    db_session.commit()

    projected = assistant._t_project_savings_goals(db_session, user)[0]

    # 12000 over ~3 months needs ~4000/mo against a real surplus of 100.
    assert projected["remaining"] == 12000.0
    assert projected["required_monthly"] > projected["avg_monthly_surplus"]
    assert projected["verdict"] == "not on track — needs more than the current surplus"
    assert projected["shortfall_monthly"] > 0


def test_simulate_scenario_compounds_and_checks_feasibility(db_session, user, account):
    _seed_months(db_session, user, account, income="4000", spending="-3800")

    result = assistant._t_simulate_scenario(
        db_session, user,
        monthly_contribution=100, months=12, annual_return_pct=12, initial_amount=0,
    )

    assert result["total_contributed"] == 1200.0
    # 1% monthly on a growing balance must beat plain saving.
    assert result["final_balance"] > 1200.0
    assert result["growth_from_returns"] > 0
    # Surplus is 200/mo, so a 100/mo contribution fits.
    assert result["feasibility"]["contribution_fits_surplus"] is True
    assert result["assumptions"]["starting_amount_source"] == "caller supplied"


def test_simulate_scenario_reports_a_contribution_it_cannot_fund(db_session, user, account):
    _seed_months(db_session, user, account, income="4000", spending="-3900")

    result = assistant._t_simulate_scenario(
        db_session, user, monthly_contribution=2000, months=12, annual_return_pct=0,
    )

    assert result["feasibility"]["contribution_fits_surplus"] is False
    assert result["feasibility"]["surplus_shortfall"] == 1900.0


def test_affordability_check_reports_runway_left_after_buying(db_session, user, account):
    _seed_months(db_session, user, account, income="4000", spending="-3000")

    verdict = assistant._t_affordability_check(db_session, user, amount=100, in_months=0)

    assert verdict["cost"] == 100.0
    assert verdict["covers_cost"] is True
    assert verdict["emergency_fund_months_after"] is not None
    assert verdict["months_to_afford_from_surplus"] == 0


def test_analyze_spending_trends_surfaces_a_rising_category(db_session, user, account, category):
    today = assistant._user_today(user)
    last_month = assistant._add_months(assistant._month_floor(today), -1)
    older = assistant._add_months(assistant._month_floor(today), -2)
    db_session.add_all(
        [
            Transaction(
                user_id=user.id, account_id=account.id, category_id=category.id,
                amount=Decimal("-100"), transaction_date=older,
            ),
            Transaction(
                user_id=user.id, account_id=account.id, category_id=category.id,
                amount=Decimal("-300"), transaction_date=last_month,
            ),
        ]
    )
    db_session.commit()

    trends = assistant._t_analyze_spending_trends(db_session, user, months=6)
    row = trends["category_trends"][0]

    assert row["latest_month_spend"] == 300.0
    assert row["prior_months_average"] == 100.0
    assert row["change_pct"] == 200.0


def test_find_recurring_waste_annualises_and_flags_dormant(db_session, user, account):
    db_session.add_all(
        [
            RecurringTransaction(
                user_id=user.id, account_id=account.id, description="Streaming",
                amount=Decimal("-10"), period="monthly",
                next_date=assistant._user_today(user), is_active=True,
            ),
            RecurringTransaction(
                user_id=user.id, account_id=account.id, description="Salary",
                amount=Decimal("4000"), period="monthly",
                next_date=assistant._user_today(user), is_active=True,
            ),
        ]
    )
    db_session.commit()

    waste = assistant._t_find_recurring_waste(db_session, user)
    by_description = {item["description"]: item for item in waste["items"]}

    assert by_description["Streaming"]["annualised_cost"] == 120.0
    # No transaction ever matched "Streaming", so it reads as dormant.
    assert by_description["Streaming"]["possibly_unused"] is True
    # Income is neither waste nor dormant, and is excluded from the total.
    assert by_description["Salary"]["direction"] == "income"
    assert by_description["Salary"]["possibly_unused"] is False
    assert waste["total_annualised_expense"] == 120.0


def test_analyze_portfolio_measures_concentration(db_session, user):
    db_session.add_all(
        [
            Asset(
                user_id=user.id, name="AAPL", type="stock", asset_class="investment",
                quantity=Decimal("10"), value_per_unit=Decimal("150"),
                total_value=Decimal("1500"),
            ),
            Asset(
                user_id=user.id, name="BTC", type="crypto", asset_class="investment",
                quantity=Decimal("0.01"), value_per_unit=Decimal("50000"),
                total_value=Decimal("500"),
            ),
            Asset(
                user_id=user.id, name="Car", type="vehicle", asset_class="physical",
                total_value=Decimal("9000"),
            ),
        ]
    )
    db_session.commit()

    portfolio = assistant._t_analyze_portfolio(db_session, user)

    # Physical assets are excluded from the investment view but not the total.
    assert portfolio["investment_total"] == 2000.0
    assert portfolio["all_assets_total"] == 11000.0
    assert portfolio["holding_count"] == 2
    assert portfolio["largest_holding_share_pct"] == 75.0
    assert portfolio["allocation_by_type"][0] == {
        "type": "stock", "value": 1500.0, "share_pct": 75.0,
    }


# ─── Prompt caching layout ───────────────────────────────────────────────────
def test_system_blocks_are_both_cached_and_free_of_live_data(db_session, user, account):
    """Both system blocks must be cacheable and contain nothing per-request.

    A clock or balance in here would invalidate the prefix on every single call,
    which is the exact regression this guards.
    """
    blocks = assistant._build_system_blocks(db_session, user)

    assert len(blocks) == 2
    assert all(block["cache_control"] == {"type": "ephemeral"} for block in blocks)
    combined = " ".join(block["text"] for block in blocks)
    assert str(assistant._user_today(user).year) not in combined
    assert "snapshot" not in combined.lower()
    # The balance lives in the volatile tail, never in the cached prefix.
    assert str(account.balance) not in combined


def test_live_context_stays_out_of_the_system_prompt(db_session, user):
    """The clock belongs at the tail of the messages array, not in `system`."""
    live = assistant._live_context_text(db_session, user)
    system_text = " ".join(b["text"] for b in assistant._build_system_blocks(db_session, user))

    assert assistant._user_today(user).isoformat() in live
    assert assistant._user_today(user).isoformat() not in system_text


def test_assembled_messages_cache_history_and_end_with_volatile_context(db_session, user):
    """History carries the breakpoint; volatile context sits after it."""
    history = [
        SimpleNamespace(role="user", content="older question"),
        SimpleNamespace(role="assistant", content="older answer"),
    ]
    messages = assistant._assemble_messages(history, "LIVE-CONTEXT", "new question")

    # Only the final history turn is marked, so earlier turns stay plain strings.
    assert messages[0]["content"] == "older question"
    assert messages[1]["content"][0]["cache_control"] == {"type": "ephemeral"}
    # The volatile block must come after all cacheable history, never before it.
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"][0]["text"] == "LIVE-CONTEXT"
    assert messages[-1]["content"][1]["text"] == "new question"
    assert not any("cache_control" in block for block in messages[-1]["content"])


def test_first_turn_assembles_without_a_history_breakpoint(db_session, user):
    messages = assistant._assemble_messages([], "LIVE", "hello")

    assert len(messages) == 1
    assert messages[0]["content"][0]["text"] == "LIVE"


def test_total_cache_breakpoints_stay_within_the_four_allowed(db_session, user):
    """The API caps explicit breakpoints at 4; the tail one is auto-placed."""
    history = [SimpleNamespace(role="user", content=f"turn {i}") for i in range(10)]
    blocks = assistant._build_system_blocks(db_session, user)
    messages = assistant._assemble_messages(history, "LIVE", "q")

    explicit = sum(1 for b in blocks if "cache_control" in b)
    for entry in messages:
        if isinstance(entry["content"], list):
            explicit += sum(1 for b in entry["content"] if "cache_control" in b)

    # 2 system + 1 history tail, leaving room for the auto-placed 4th.
    assert explicit == 3


# ─── Tier routing ────────────────────────────────────────────────────────────
def test_router_sends_advice_and_market_questions_deep():
    for question in [
        "Should I buy gold right now?",
        "What is the price of gold?",
        "Can I afford a 30000 car?",
        "How much should I invest each month to retire at 60?",
        "Compare my portfolio against an index fund",
        "Why is my spending up this month?",
    ]:
        assert assistant._route_request(question) == "deep", question


def test_router_sends_plain_lookups_quick():
    for question in [
        "What's my balance?",
        "How much did I spend this month?",
        "List my accounts",
        "What is my net worth?",
    ]:
        assert assistant._route_request(question) == "quick", question


def test_router_prefers_depth_when_a_lookup_also_asks_for_judgement():
    """"How much should I invest" reads like a lookup but needs real reasoning."""
    assert assistant._route_request("How much should I invest?") == "deep"
    assert assistant._route_request("What's my balance, and should I invest it?") == "deep"
    # An explicit request for depth always wins.
    assert assistant._route_request("What's my balance? Think hard.") == "deep"


def test_router_defaults_to_standard_when_unsure():
    assert assistant._route_request("Categorise the Amazon charge from Tuesday") == "standard"
    # Long messages are never quick even when they contain lookup words.
    assert assistant._route_request("balance " * 40) == "standard"


def test_quick_tier_excludes_search_analytics_and_writes():
    """Haiku cannot use the _20260209 search tool or the effort parameter."""
    quick = {schema["name"] for schema in assistant._tool_schemas(assistant.QUICK_TOOL_NAMES)}

    assert quick == set(assistant.QUICK_TOOL_NAMES)
    assert not quick & assistant.WRITE_TOOLS
    assert "simulate_scenario" not in quick
    assert assistant.TIERS["quick"]["effort"] is None
    assert assistant.TIERS["quick"]["thinking"] is False
    assert assistant.TIERS["quick"]["model"] == assistant.FAST_MODEL


def test_full_tool_list_is_unfiltered_and_order_is_stable():
    """Reordering the tool list would invalidate the entire cached prefix."""
    first = [schema["name"] for schema in assistant._tool_schemas()]
    second = [schema["name"] for schema in assistant._tool_schemas()]

    assert first == second
    assert len(first) == len(assistant.READ_TOOLS) + len(assistant.WRITE_TOOLS)


# ─── Cost accounting ─────────────────────────────────────────────────────────
def test_usage_accumulates_across_every_call_in_a_turn():
    totals = {
        "input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0, "web_searches": 0,
    }
    for _ in range(3):
        assistant._accumulate_usage(totals, SimpleNamespace(usage=SimpleNamespace(
            input_tokens=100, output_tokens=50,
            cache_read_input_tokens=2000, cache_creation_input_tokens=10,
            server_tool_use=SimpleNamespace(web_search_requests=1),
        )))

    assert totals["input_tokens"] == 300
    assert totals["output_tokens"] == 150
    assert totals["cache_read_input_tokens"] == 6000
    assert totals["web_searches"] == 3


def test_price_usage_charges_cache_reads_at_a_tenth_of_input():
    totals = {
        "input_tokens": 1_000_000, "output_tokens": 0,
        "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "web_searches": 0,
    }
    full = assistant._price_usage(totals, "claude-sonnet-5")["estimated_cost_usd"]

    cached = assistant._price_usage(
        {**totals, "input_tokens": 0, "cache_read_input_tokens": 1_000_000},
        "claude-sonnet-5",
    )["estimated_cost_usd"]

    assert full == 2.0
    assert round(cached, 6) == 0.2


def test_price_usage_reports_the_cache_hit_rate(db_session):
    summary = assistant._price_usage(
        {
            "input_tokens": 1000, "output_tokens": 500,
            "cache_read_input_tokens": 9000, "cache_creation_input_tokens": 0,
            "web_searches": 2,
        },
        "claude-sonnet-5",
    )

    assert summary["cache_hit_rate_pct"] == 90.0
    assert summary["web_searches"] == 2
    assert summary["model"] == "claude-sonnet-5"


def _fake_anthropic(captured: list, *, reply="Here is the answer."):
    """A stand-in for the streaming SDK that records the kwargs it was called with."""
    class FakeStream:
        def __init__(self, kwargs):
            self._kwargs = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def get_final_message(self):
            return SimpleNamespace(
                stop_reason="end_turn",
                content=[SimpleNamespace(type="text", text=reply)],
                usage=SimpleNamespace(
                    input_tokens=300, output_tokens=120,
                    cache_read_input_tokens=5000, cache_creation_input_tokens=200,
                    server_tool_use=SimpleNamespace(web_search_requests=0),
                ),
            )

    class FakeMessages:
        def stream(self, **kwargs):
            captured.append(kwargs)
            return FakeStream(kwargs)

    class FakeAnthropic:
        def __init__(self, **_kwargs):
            self.messages = FakeMessages()

    return SimpleNamespace(Anthropic=FakeAnthropic, APIError=type("E", (Exception,), {}))


def test_successful_chat_returns_reply_tier_and_priced_usage(
    client, db_session, auth_headers, monkeypatch
):
    """Exercises the happy path end to end — nothing else covers it."""
    captured: list = []
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setitem(sys.modules, "anthropic", _fake_anthropic(captured))

    response = client.post(
        "/assistant/chat",
        headers=auth_headers,
        json={"message": "Should I move my savings into an index fund?",
              "timezone": "America/New_York"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["reply"] == "Here is the answer."
    assert payload["tier"] == "deep"
    assert payload["usage"]["model"] == assistant.MODEL
    assert payload["usage"]["estimated_cost_usd"] > 0
    assert payload["usage"]["cache_hit_rate_pct"] > 0
    # One turn is persisted as two rows, and the conversation now exists.
    assert db_session.query(AssistantConversation).count() == 1


def test_deep_turn_requests_thinking_effort_and_the_cache_breakpoint(
    client, auth_headers, monkeypatch
):
    captured: list = []
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setitem(sys.modules, "anthropic", _fake_anthropic(captured))

    client.post(
        "/assistant/chat", headers=auth_headers,
        json={"message": "Should I buy gold?"},
    )

    sent = captured[0]
    assert sent["model"] == assistant.MODEL
    assert sent["thinking"] == {"type": "adaptive"}
    assert sent["output_config"] == {"effort": "high"}
    # The auto-placed fourth breakpoint.
    assert sent["cache_control"] == {"type": "ephemeral"}
    # Both system blocks cached, and web search available on this tier.
    assert all("cache_control" in block for block in sent["system"])
    assert any(tool.get("type", "").startswith("web_search") for tool in sent["tools"])


def test_quick_turn_omits_effort_and_thinking_that_haiku_rejects(
    client, auth_headers, monkeypatch
):
    """Sending output_config.effort to Haiku 4.5 is an API error, so it must not appear."""
    captured: list = []
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setitem(sys.modules, "anthropic", _fake_anthropic(captured))

    response = client.post(
        "/assistant/chat", headers=auth_headers, json={"message": "What's my balance?"},
    )

    assert response.json()["tier"] == "quick"
    sent = captured[0]
    assert sent["model"] == assistant.FAST_MODEL
    assert "output_config" not in sent
    assert "thinking" not in sent
    # No web search on the quick tier — Haiku cannot use the _20260209 variant.
    assert not any(tool.get("type", "").startswith("web_search") for tool in sent["tools"])
    assert len(sent["tools"]) == len(assistant.QUICK_TOOL_NAMES)


def test_quick_turn_is_cheaper_than_deep_for_identical_token_counts(
    client, auth_headers, monkeypatch
):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setitem(sys.modules, "anthropic", _fake_anthropic([]))

    quick = client.post(
        "/assistant/chat", headers=auth_headers, json={"message": "What's my balance?"},
    ).json()
    deep = client.post(
        "/assistant/chat", headers=auth_headers, json={"message": "Should I buy gold?"},
    ).json()

    assert quick["usage"]["estimated_cost_usd"] < deep["usage"]["estimated_cost_usd"]


def test_quick_tier_is_materially_cheaper_than_deep():
    """The whole point of routing: identical traffic must cost less on Haiku."""
    totals = {
        "input_tokens": 5000, "output_tokens": 1000,
        "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "web_searches": 0,
    }
    sonnet = assistant._price_usage(totals, "claude-sonnet-5")["estimated_cost_usd"]
    haiku = assistant._price_usage(totals, "claude-haiku-4-5")["estimated_cost_usd"]

    assert haiku * 2 == sonnet
