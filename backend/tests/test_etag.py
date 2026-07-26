"""Verify GET endpoints emit weak ETags and honor If-None-Match with 304."""

from datetime import date
from decimal import Decimal


def _get_etag(headers) -> str:
    return headers.get("etag") or headers.get("ETag") or ""


def test_accounts_get_returns_weak_etag(client, auth_headers, account):
    response = client.get("/accounts/", headers=auth_headers)
    assert response.status_code == 200
    assert _get_etag(response.headers).startswith('W/"')


def test_accounts_get_returns_304_on_matching_if_none_match(client, auth_headers, account):
    first = client.get("/accounts/", headers=auth_headers)
    etag = _get_etag(first.headers)
    assert etag

    second = client.get("/accounts/", headers={**auth_headers, "If-None-Match": etag})
    assert second.status_code == 304
    # 304 responses have no body per RFC 7232, but must echo the ETag so the
    # browser can associate the still-valid cached body.
    assert _get_etag(second.headers) == etag


def test_accounts_etag_changes_when_account_is_added(client, db_session, user, auth_headers, account):
    first_etag = _get_etag(client.get("/accounts/", headers=auth_headers).headers)

    from models.database import Account
    db_session.add(Account(user_id=user.id, name="New", type="checking", balance=Decimal("0")))
    db_session.commit()

    second = client.get("/accounts/", headers={**auth_headers, "If-None-Match": first_etag})
    # A new row must invalidate the cache — server should return 200, not 304.
    assert second.status_code == 200
    new_etag = _get_etag(second.headers)
    assert new_etag != first_etag


def test_categories_etag_includes_system_categories(client, auth_headers):
    response = client.get("/categories", headers=auth_headers, follow_redirects=True)
    assert response.status_code == 200
    etag = _get_etag(response.headers)
    assert etag.startswith('W/"')

    revalidate = client.get(
        "/categories", headers={**auth_headers, "If-None-Match": etag}, follow_redirects=True
    )
    assert revalidate.status_code == 304


def test_assets_etag_varies_with_asset_class_filter(client, auth_headers):
    all_etag = _get_etag(client.get("/assets", headers=auth_headers, follow_redirects=True).headers)
    filtered_etag = _get_etag(
        client.get("/assets?asset_class=investment", headers=auth_headers, follow_redirects=True).headers
    )
    assert all_etag and filtered_etag
    assert all_etag != filtered_etag
