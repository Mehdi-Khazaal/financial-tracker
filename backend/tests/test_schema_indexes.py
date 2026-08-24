"""Indexes the application's hot queries depend on.

An index is invisible until it is missing, and then it is invisible in a
different way: everything still works, just slower and slower as data grows.
These assert the declarations exist, so removing one is a test failure rather
than a gradual regression nobody attributes to a schema change.

Declarations, not timings — a benchmark here would be flaky on CI and would not
say which index was gone.
"""

from models.database import Account, Transaction, UserPreferences


def _index_columns(table) -> set:
    return {tuple(c.name for c in index.columns) for index in table.indexes}


def test_transactions_can_be_listed_by_date_without_a_sort():
    """`WHERE user_id = ? ORDER BY transaction_date DESC` — the app's most
    frequent query, and for a long time the one with nothing behind it."""
    assert ("user_id", "transaction_date") in _index_columns(Transaction.__table__)


def test_merchant_history_lookups_stay_indexed():
    columns = _index_columns(Transaction.__table__)
    assert ("user_id", "merchant_key") in columns
    assert ("user_id", "plaid_merchant_entity_id") in columns


def test_every_transaction_index_is_scoped_to_a_user():
    """A tenant-wide index would serve one user's query by reading everyone's."""
    for columns in _index_columns(Transaction.__table__):
        if columns == ("id",):
            continue
        assert columns[0] == "user_id", f"{columns} does not start with user_id"


def test_a_plaid_account_maps_to_one_local_account():
    assert Account.__table__.c.plaid_account_id.unique is True


def test_a_user_has_at_most_one_preferences_row():
    assert UserPreferences.__table__.c.user_id.unique is True
