"""Merchant identity resolution and deterministic category suggestion."""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Category, MerchantAlias, Transaction
from services import merchants, user_preferences
from services.transaction_enrichment import (
    MIN_HISTORY_OBSERVATIONS,
    auto_categorize_enabled,
    SOURCE_MERCHANT_HISTORY,
    SOURCE_PLAID_PFC,
    SOURCE_USER,
    enrich_transaction_input,
    resolve_transaction_merchant,
    suggest_transaction_category,
)
from utils import auth as auth_utils


# ─── Normalization: the required grouping cases ───────────────────────────────
NETFLIX_VARIANTS = [
    "NETFLIX",
    "NETFLIX.COM",
    "NETFLIX 800-585-3000",
    "Netflix.com 866-579-7172",
    "NETFLIX*MEMBERSHIP",
    "NETFLIX INC",
    "netflix",
    "www.netflix.com",
    "ACH DEBIT NETFLIX",
    "POS PURCHASE NETFLIX 998877",
    "SQ *NETFLIX",
    "NETFLIX 8005853000",
    "Netflix Subscription",
    "PURCHASE AUTHORIZED ON 03/15 NETFLIX.COM",
]


@pytest.mark.parametrize("raw", NETFLIX_VARIANTS)
def test_netflix_variants_share_one_key(raw):
    assert merchants.normalize(raw) == "netflix"


def test_netflix_variants_collapse_to_a_single_group():
    assert len({merchants.normalize(v) for v in NETFLIX_VARIANTS}) == 1


# ─── Normalization must not over-merge ────────────────────────────────────────
@pytest.mark.parametrize(
    "left,right",
    [
        ("Apple Store", "Apple Bakery"),
        ("Apple Store", "Apple"),
        ("Corner Grocer", "Corner Bakery"),
        ("Bank of America", "Bank of the West"),
        ("Shell", "Shell Fish Market"),
        ("Netflix", "Netflix Games Studio"),
        ("AMZN Mktp", "Amazon Fresh"),
    ],
)
def test_unrelated_merchants_stay_distinct(left, right):
    assert merchants.normalize(left) != merchants.normalize(right)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("SQ *COFFEE BAR", "coffee bar"),
        ("TST* DINER", "diner"),
        ("PAYPAL *ETSY SELLER", "etsy seller"),
        ("PP*GITHUB", "github"),
        ("CHECKCARD 03-15-26 DINER", "diner"),
        ("POS DEBIT SQ *CAFE", "cafe"),
        ("STARBUCKS #123", "starbucks"),
        ("STARBUCKS #999", "starbucks"),
        # Short numerics that are part of a name survive.
        ("7-11", "7 11"),
        ("24HR FITNESS", "24hr fitness"),
        # Alphanumeric reference codes are shed.
        ("SPOTIFY P1A2B3C", "spotify"),
        ("SPOTIFY Q9Z8Y7X", "spotify"),
    ],
)
def test_normalization_cases(raw, expected):
    assert merchants.normalize(raw) == expected


@pytest.mark.parametrize("raw", NETFLIX_VARIANTS + ["", "   ", "SQ *CAFE", "7-11"])
def test_normalize_is_idempotent(raw):
    once = merchants.normalize(raw)
    assert merchants.normalize(once) == once


def test_empty_description_yields_no_identity():
    identity = resolve_transaction_merchant(None)
    assert not identity.is_resolvable
    assert merchants.merchant_key("") == ""


# ─── Identity precedence ──────────────────────────────────────────────────────
def test_plaid_entity_id_is_primary_identity():
    identity = resolve_transaction_merchant(
        "NETFLIX.COM 866-579-7172", plaid_merchant_entity_id="ent_netflix"
    )
    assert identity.entity_id == "ent_netflix"
    # The key is still derived, as a fallback for rows that lack an entity ID.
    assert identity.key == "netflix"


def test_blank_entity_id_is_treated_as_absent():
    identity = resolve_transaction_merchant("Netflix", plaid_merchant_entity_id="   ")
    assert identity.entity_id is None


# ─── Category suggestion ──────────────────────────────────────────────────────
def _seed_history(db_session, user, account, category, descriptions, *, entity_id=None):
    for index, description in enumerate(descriptions):
        db_session.add(
            Transaction(
                user_id=user.id,
                account_id=account.id,
                category_id=category.id,
                amount=Decimal("-9.99"),
                description=description,
                merchant_key=merchants.merchant_key(description),
                plaid_merchant_entity_id=entity_id,
                transaction_date=date(2026, 1, index + 1),
            )
        )
    db_session.commit()


def test_suggests_from_merchant_key_history(db_session, user, account, category):
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    identity = resolve_transaction_merchant("NETFLIX*MEMBERSHIP")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)
    assert suggested == category.id
    assert source == SOURCE_MERCHANT_HISTORY


def test_suggests_from_entity_id_history(db_session, user, account, category):
    _seed_history(
        db_session, user, account, category,
        ["WEIRD BANK STRING 1", "WEIRD BANK STRING 2"],
        entity_id="ent_netflix",
    )
    # A description that normalizes to something unrelated still resolves,
    # because the entity ID is the primary identity.
    identity = resolve_transaction_merchant("ANOTHER ODD STRING", plaid_merchant_entity_id="ent_netflix")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)
    assert suggested == category.id
    assert source == SOURCE_MERCHANT_HISTORY


def test_single_observation_is_below_the_confidence_bar(db_session, user, account, category):
    assert MIN_HISTORY_OBSERVATIONS == 2
    _seed_history(db_session, user, account, category, ["NETFLIX"])
    identity = resolve_transaction_merchant("NETFLIX")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)
    assert suggested is None
    assert source is None


def test_tied_history_yields_no_suggestion(db_session, user, account, category):
    other = Category(user_id=user.id, name="Entertainment", type="expense")
    db_session.add(other)
    db_session.commit()
    _seed_history(db_session, user, account, category, ["NETFLIX"])
    _seed_history(db_session, user, account, other, ["NETFLIX.COM"])

    identity = resolve_transaction_merchant("NETFLIX")
    suggested, _ = suggest_transaction_category(db_session, user.id, identity)
    assert suggested is None


def test_dominant_category_wins_over_a_stray(db_session, user, account, category):
    other = Category(user_id=user.id, name="Entertainment", type="expense")
    db_session.add(other)
    db_session.commit()
    # 3 of 4 = 75%, above the 60% bar.
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX", "NETFLIX"])
    _seed_history(db_session, user, account, other, ["NETFLIX"])

    identity = resolve_transaction_merchant("NETFLIX")
    suggested, _ = suggest_transaction_category(db_session, user.id, identity)
    assert suggested == category.id


def test_legacy_rows_without_merchant_key_still_vote(db_session, user, account, category):
    """The third precedence tier, for rows predating the backfill."""
    for index, description in enumerate(["NETFLIX", "NETFLIX.COM"]):
        db_session.add(
            Transaction(
                user_id=user.id,
                account_id=account.id,
                category_id=category.id,
                amount=Decimal("-9.99"),
                description=description,
                merchant_key=None,  # un-backfilled
                transaction_date=date(2026, 1, index + 1),
            )
        )
    db_session.commit()

    identity = resolve_transaction_merchant("NETFLIX*MEMBERSHIP")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)
    assert suggested == category.id
    assert source == SOURCE_MERCHANT_HISTORY


# ─── Tenant isolation ─────────────────────────────────────────────────────────
def test_another_users_history_never_influences_a_suggestion(db_session, user, account, category):
    other_user = User(
        email="other@example.com",
        username="other",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
    )
    db_session.add(other_user)
    db_session.commit()
    other_account = Account(user_id=other_user.id, name="Theirs", type="checking", balance=0)
    other_category = Category(user_id=other_user.id, name="Their Category", type="expense")
    db_session.add_all([other_account, other_category])
    db_session.commit()

    # A long, unambiguous history — but it belongs to somebody else.
    _seed_history(
        db_session, other_user, other_account, other_category,
        ["NETFLIX", "NETFLIX", "NETFLIX", "NETFLIX"],
    )

    identity = resolve_transaction_merchant("NETFLIX")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)
    assert suggested is None
    assert source is None


# ─── Plaid PFC fallback ───────────────────────────────────────────────────────
def test_pfc_maps_to_an_existing_user_category(db_session, user, account):
    dining = Category(user_id=user.id, name="Food & Dining", type="expense")
    db_session.add(dining)
    db_session.commit()

    identity = resolve_transaction_merchant("SOME NEW CAFE")
    suggested, source = suggest_transaction_category(
        db_session, user.id, identity, pfc_primary="FOOD_AND_DRINK"
    )
    assert suggested == dining.id
    assert source == SOURCE_PLAID_PFC


def test_pfc_is_ignored_when_the_user_has_no_matching_category(db_session, user, account):
    identity = resolve_transaction_merchant("SOME NEW CAFE")
    suggested, source = suggest_transaction_category(
        db_session, user.id, identity, pfc_primary="FOOD_AND_DRINK"
    )
    assert suggested is None
    assert source is None


def test_unmapped_pfc_leaves_transaction_uncategorized(db_session, user, account, category):
    identity = resolve_transaction_merchant("SOME TRANSFER")
    suggested, source = suggest_transaction_category(
        db_session, user.id, identity, pfc_primary="TRANSFER_IN"
    )
    assert suggested is None
    assert source is None


def test_history_takes_precedence_over_pfc(db_session, user, account, category):
    dining = Category(user_id=user.id, name="Food & Dining", type="expense")
    db_session.add(dining)
    db_session.commit()
    # History says `category` (Food), PFC says Food & Dining. History wins.
    _seed_history(db_session, user, account, category, ["CAFE ROMA", "CAFE ROMA"])

    identity = resolve_transaction_merchant("CAFE ROMA")
    suggested, source = suggest_transaction_category(
        db_session, user.id, identity, pfc_primary="FOOD_AND_DRINK"
    )
    assert suggested == category.id
    assert source == SOURCE_MERCHANT_HISTORY


# ─── enrich_transaction_input ─────────────────────────────────────────────────
def test_enrichment_populates_merchant_key(db_session, user, account):
    result = enrich_transaction_input(
        db_session, user.id,
        {"account_id": account.id, "amount": Decimal("-5"), "description": "SQ *CAFE 1234"},
    )
    assert result["merchant_key"] == "cafe"


def test_enrichment_never_overrides_an_explicit_category(db_session, user, account, category):
    other = Category(user_id=user.id, name="Entertainment", type="expense")
    db_session.add(other)
    db_session.commit()
    _seed_history(db_session, user, account, other, ["NETFLIX", "NETFLIX"])

    result = enrich_transaction_input(
        db_session, user.id,
        {
            "account_id": account.id,
            "amount": Decimal("-9.99"),
            "description": "NETFLIX",
            "category_id": category.id,
        },
    )
    assert result["category_id"] == category.id
    assert result["category_source"] == SOURCE_USER


def test_enrichment_does_not_mutate_its_input(db_session, user, account):
    values = {"account_id": account.id, "amount": Decimal("-5"), "description": "NETFLIX"}
    enrich_transaction_input(db_session, user.id, values)
    assert "merchant_key" not in values


# ─── Auto-categorization kill switch ──────────────────────────────────────────
def test_auto_categorize_defaults_to_enabled(monkeypatch):
    monkeypatch.delenv("AUTO_CATEGORIZE", raising=False)
    assert auto_categorize_enabled() is True


@pytest.mark.parametrize("value", ["false", "FALSE", "False", " false "])
def test_auto_categorize_disabled_only_by_false(monkeypatch, value):
    monkeypatch.setenv("AUTO_CATEGORIZE", value)
    assert auto_categorize_enabled() is False


@pytest.mark.parametrize("value", ["true", "1", "yes", "", "off"])
def test_anything_other_than_false_leaves_it_enabled(monkeypatch, value):
    monkeypatch.setenv("AUTO_CATEGORIZE", value)
    assert auto_categorize_enabled() is True


def test_switch_off_leaves_new_rows_uncategorized(monkeypatch, db_session, user, account, category):
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    monkeypatch.setenv("AUTO_CATEGORIZE", "false")

    identity = resolve_transaction_merchant("NETFLIX*MEMBERSHIP")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)
    assert suggested is None
    assert source is None


def test_switch_off_still_stores_merchant_identity(monkeypatch, db_session, user, account, category):
    """Disabling categorization must not disable enrichment."""
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    monkeypatch.setenv("AUTO_CATEGORIZE", "false")

    result = enrich_transaction_input(
        db_session, user.id,
        {
            "account_id": account.id,
            "amount": Decimal("-9.99"),
            "description": "NETFLIX*MEMBERSHIP",
            "plaid_merchant_entity_id": "ent_netflix",
            "payment_channel": "online",
        },
    )
    assert result["merchant_key"] == "netflix"
    assert result["plaid_merchant_entity_id"] == "ent_netflix"
    assert result["payment_channel"] == "online"   # metadata untouched
    assert result.get("category_id") is None       # only categorization stops


def test_switch_off_never_disturbs_an_explicit_category(monkeypatch, db_session, user, account, category):
    monkeypatch.setenv("AUTO_CATEGORIZE", "false")
    result = enrich_transaction_input(
        db_session, user.id,
        {
            "account_id": account.id,
            "amount": Decimal("-9.99"),
            "description": "NETFLIX",
            "category_id": category.id,
        },
    )
    assert result["category_id"] == category.id
    assert result["category_source"] == SOURCE_USER

# ─── The per-user preference (Phase 6D) ───────────────────────────────────────
# The operator's `AUTO_CATEGORIZE` switch above and the user's preference are
# two different questions. These tests hold the same line for the user-level
# one: turning it off stops Fintrack *choosing* a category and nothing else.
# Enrichment, merchant identity, Plaid metadata, alias registration and the
# import itself all continue — the transaction simply arrives uncategorized,
# ready to be filed by hand.


def _disable_for(db_session, user_id):
    user_preferences.upsert(db_session, user_id, {"automatic_categorization_enabled": False})
    db_session.commit()


def test_a_user_who_opts_out_gets_no_suggestion(db_session, user, account, category):
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    _disable_for(db_session, user.id)

    identity = resolve_transaction_merchant("NETFLIX*MEMBERSHIP")
    suggested, source = suggest_transaction_category(db_session, user.id, identity)

    assert suggested is None
    assert source is None


def test_opting_out_does_not_stop_merchant_enrichment(db_session, user, account, category):
    """The separation this phase has to prove: identity is not categorization."""
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    _disable_for(db_session, user.id)

    result = enrich_transaction_input(
        db_session, user.id,
        {
            "account_id": account.id,
            "amount": Decimal("-9.99"),
            "description": "NETFLIX*MEMBERSHIP",
            "plaid_merchant_entity_id": "ent_netflix",
            "payment_channel": "online",
            "personal_finance_category_primary": "ENTERTAINMENT",
        },
    )

    assert result["merchant_key"] == "netflix"
    assert result["plaid_merchant_entity_id"] == "ent_netflix"
    assert result["payment_channel"] == "online"
    assert result["personal_finance_category_primary"] == "ENTERTAINMENT"
    # Only the choosing stops.
    assert result.get("category_id") is None
    assert result["category_source"] is None


def test_opting_out_stops_the_pfc_fallback_too(db_session, user, account):
    """Both suggestion routes are behind the same gate, not just history."""
    db_session.add(Category(user_id=user.id, name="Entertainment", type="expense", color="#ffffff"))
    db_session.commit()
    _disable_for(db_session, user.id)

    identity = resolve_transaction_merchant("SOME UNKNOWN MERCHANT")
    suggested, source = suggest_transaction_category(
        db_session, user.id, identity, pfc_primary="ENTERTAINMENT"
    )

    assert suggested is None
    assert source is None


def test_opting_out_never_disturbs_a_category_the_user_chose(db_session, user, account, category):
    _disable_for(db_session, user.id)

    result = enrich_transaction_input(
        db_session, user.id,
        {
            "account_id": account.id,
            "amount": Decimal("-9.99"),
            "description": "NETFLIX",
            "category_id": category.id,
        },
    )

    assert result["category_id"] == category.id
    assert result["category_source"] == SOURCE_USER


def test_opting_out_still_registers_the_merchant_alias(db_session, user, account, category):
    """Learning who a merchant is continues, so filing by hand still improves."""
    _disable_for(db_session, user.id)

    enrich_transaction_input(
        db_session, user.id,
        {"account_id": account.id, "amount": Decimal("-9.99"), "description": "NETFLIX*MEMBERSHIP"},
    )
    db_session.commit()

    assert db_session.query(MerchantAlias).count() > 0


def test_one_users_choice_does_not_affect_another(db_session, user, account, category):
    other = User(
        email="other-enrich@example.com",
        username="otherenrich",
        hashed_password="x",
        is_verified=True,
    )
    db_session.add(other)
    db_session.commit()
    db_session.refresh(other)

    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    _seed_history(db_session, other, account, category, ["NETFLIX", "NETFLIX.COM"])
    _disable_for(db_session, user.id)

    identity = resolve_transaction_merchant("NETFLIX*MEMBERSHIP")
    assert suggest_transaction_category(db_session, user.id, identity)[0] is None
    assert suggest_transaction_category(db_session, other.id, identity)[0] == category.id


def test_the_user_preference_cannot_re_enable_a_globally_disabled_feature(
    monkeypatch, db_session, user, account, category
):
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": True})
    db_session.commit()
    monkeypatch.setenv("AUTO_CATEGORIZE", "false")

    identity = resolve_transaction_merchant("NETFLIX*MEMBERSHIP")
    assert suggest_transaction_category(db_session, user.id, identity)[0] is None


def test_turning_it_back_on_restores_suggestions(db_session, user, account, category):
    _seed_history(db_session, user, account, category, ["NETFLIX", "NETFLIX.COM"])
    _disable_for(db_session, user.id)
    identity = resolve_transaction_merchant("NETFLIX*MEMBERSHIP")
    assert suggest_transaction_category(db_session, user.id, identity)[0] is None

    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": True})
    db_session.commit()

    assert suggest_transaction_category(db_session, user.id, identity)[0] == category.id
