"""Merchant normalization + category auto-fill."""

from datetime import date
from decimal import Decimal

from models.database import Category, MerchantAlias, MerchantCanonical, Transaction
from services import merchants


def test_normalize_sheds_reference_codes():
    # "AMZN" and "AMAZON" are different words, so these do *not* collapse —
    # normalization never guesses that two spellings are the same business.
    # What it must do is shed the trailing reference codes, so repeat charges
    # from each spelling group with themselves.
    assert merchants.normalize("AMAZON MKTP #98765") == merchants.normalize("AMAZON MKTP #11122")
    assert merchants.normalize("AMZN Mktp US*A12BC") == merchants.normalize("AMZN Mktp US*Z98YX")


def test_resolve_or_create_dedupes_aliases(db_session):
    c1 = merchants.resolve_or_create(db_session, "STARBUCKS #123")
    c2 = merchants.resolve_or_create(db_session, "STARBUCKS #999")
    db_session.commit()
    assert c1 is not None and c2 is not None
    assert c1.id == c2.id
    aliases = db_session.query(MerchantAlias).filter_by(canonical_id=c1.id).count()
    assert aliases == 2
    total_canonical = db_session.query(MerchantCanonical).count()
    assert total_canonical == 1


def test_create_transaction_auto_fills_category(client, db_session, user, auth_headers, account):
    # Seed a category and prior transactions so history exists.
    #
    # Two observations, not one: category suggestion now requires
    # `MIN_HISTORY_OBSERVATIONS` before it will assign anything, because a
    # single prior transaction is as likely to be a one-off miscategorization
    # as an established habit. These rows are inserted directly and so carry no
    # `merchant_key`, which also exercises the legacy-description fallback tier.
    cat = Category(user_id=user.id, name="Coffee", type="expense")
    db_session.add(cat)
    db_session.commit()
    db_session.add_all([
        Transaction(
            user_id=user.id,
            account_id=account.id,
            category_id=cat.id,
            amount=Decimal("-4.50"),
            description="STARBUCKS #123",
            transaction_date=date(2026, 1, 1),
        ),
        Transaction(
            user_id=user.id,
            account_id=account.id,
            category_id=cat.id,
            amount=Decimal("-5.10"),
            description="STARBUCKS #456",
            transaction_date=date(2026, 1, 8),
        ),
    ])
    # Register the alias for the raw description.
    merchants.resolve_or_create(db_session, "STARBUCKS #123")
    db_session.commit()

    # New POST without category_id — service should suggest the coffee category.
    response = client.post(
        "/transactions/",
        json={
            "account_id": account.id,
            "amount": -5.25,
            "description": "STARBUCKS #123",
            "transaction_date": "2026-02-15",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["category_id"] == cat.id


def test_create_transaction_respects_explicit_category(client, db_session, user, auth_headers, account):
    cat_a = Category(user_id=user.id, name="A", type="expense")
    cat_b = Category(user_id=user.id, name="B", type="expense")
    db_session.add_all([cat_a, cat_b])
    db_session.commit()

    db_session.add(Transaction(
        user_id=user.id,
        account_id=account.id,
        category_id=cat_a.id,
        amount=Decimal("-10"),
        description="CHIPOTLE",
        transaction_date=date(2026, 1, 1),
    ))
    merchants.resolve_or_create(db_session, "CHIPOTLE")
    db_session.commit()

    response = client.post(
        "/transactions/",
        json={
            "account_id": account.id,
            "amount": -12,
            "description": "CHIPOTLE",
            "category_id": cat_b.id,
            "transaction_date": "2026-02-15",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    assert response.json()["category_id"] == cat_b.id
