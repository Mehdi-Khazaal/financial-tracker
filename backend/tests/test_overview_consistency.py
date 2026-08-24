"""The assistant's numbers must agree with the app's.

`get_overview` is what Fin answers "how am I doing" from. It reports a
deliberately broader net worth than the Accounts page — it adds portfolio
assets and money lent out, because someone asking an assistant what they are
worth means everything.

Broader is fine. *Missing a component* is not. Credit card balances were
excluded from every term, so a card debt simply did not exist in Fin's answer
and it quoted a number higher than the Accounts page for the same person.
"""

from decimal import Decimal

import pytest

from models.database import Account, Asset, Loan
from routers.assistant import _t_get_overview


@pytest.fixture
def cash(db_session, user):
    row = Account(
        user_id=user.id, name="Everyday", type="checking",
        balance=Decimal("1000"), currency="USD",
    )
    db_session.add(row)
    db_session.commit()
    return row


def _card(db_session, user, balance, name="Card"):
    row = Account(
        user_id=user.id, name=name, type="credit_card",
        balance=Decimal(str(balance)), currency="USD", credit_limit=Decimal("3000"),
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_card_debt_lowers_net_worth(db_session, user, cash):
    """The defect: $500 of debt used to leave net worth at $1,000."""
    _card(db_session, user, -500)

    result = _t_get_overview(db_session, user)

    assert Decimal(str(result["estimated_net_worth"])) == Decimal("500")


def test_a_card_in_credit_raises_net_worth(db_session, user, cash):
    """The other direction, now that an overpaid card is stored positive."""
    _card(db_session, user, 50)

    result = _t_get_overview(db_session, user)

    assert Decimal(str(result["estimated_net_worth"])) == Decimal("1050")


def test_several_cards_net_against_each_other(db_session, user, cash):
    _card(db_session, user, -500, name="Owed Card")
    _card(db_session, user, 50, name="Credit Card")

    result = _t_get_overview(db_session, user)

    assert Decimal(str(result["credit_card_balance"])) == Decimal("-450")
    assert Decimal(str(result["estimated_net_worth"])) == Decimal("550")


def test_no_cards_is_unchanged(db_session, user, cash):
    """Anyone without a card sees exactly what they saw before."""
    result = _t_get_overview(db_session, user)
    assert Decimal(str(result["estimated_net_worth"])) == Decimal("1000")


def test_assets_and_loans_still_count(db_session, user, cash):
    db_session.add(Asset(
        user_id=user.id, name="Gold", type="gold",
        quantity=Decimal("1"), value_per_unit=Decimal("2000"), total_value=Decimal("2000"),
    ))
    db_session.add(Loan(
        user_id=user.id, borrower_name="A Friend", amount=Decimal("300"),
        amount_repaid=Decimal("100"), loan_date=__import__("datetime").date(2026, 1, 1),
        status="active",
    ))
    _card(db_session, user, -500)
    db_session.commit()

    result = _t_get_overview(db_session, user)

    # 1000 cash − 500 card + 2000 gold + 200 still owed to the user.
    assert Decimal(str(result["estimated_net_worth"])) == Decimal("2700")


def test_the_reported_parts_still_add_up_to_the_total(db_session, user, cash):
    """Whatever the terms are, the total has to be their sum."""
    _card(db_session, user, -500)
    db_session.add(Asset(
        user_id=user.id, name="Gold", type="gold",
        quantity=Decimal("1"), value_per_unit=Decimal("2000"), total_value=Decimal("2000"),
    ))
    db_session.commit()

    result = _t_get_overview(db_session, user)

    parts = (
        Decimal(str(result["liquid_balance"]))
        + Decimal(str(result["credit_card_balance"]))
        + Decimal(str(result["assets_total"]))
        + Decimal(str(result["loans_owed_to_you"]))
    )
    assert parts == Decimal(str(result["estimated_net_worth"]))


def test_one_users_cards_do_not_reach_another(db_session, user, cash):
    from models.auth import User
    from utils import auth as auth_utils

    stranger = User(
        email="stranger-overview@example.com", username="strangerov",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True, is_admin=False,
    )
    db_session.add(stranger)
    db_session.commit()
    db_session.add(Account(
        user_id=stranger.id, name="Their Card", type="credit_card",
        balance=Decimal("-9999"), currency="USD",
    ))
    db_session.commit()

    result = _t_get_overview(db_session, user)

    assert Decimal(str(result["estimated_net_worth"])) == Decimal("1000")
