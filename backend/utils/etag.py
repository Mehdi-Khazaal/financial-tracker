"""HTTP caching helpers — ETag + If-None-Match for expensive read endpoints.

The dashboard reissues 4-6 GETs on every pull-to-refresh. When nothing has
changed, computing and serializing thousands of rows just to have the client
throw them away is wasteful, especially on 4G. A weak ETag derived from
`(max(updated_at), max(created_at), count(*))` per user + table catches inserts,
deletes, and edits (where an updated_at column exists) and lets the server
short-circuit to a 304 in ~20ms.

Weak ETags are correct here because the payload is JSON that may be
byte-different (dict ordering) even when semantically identical.
"""

from __future__ import annotations

import hashlib
from typing import Iterable, Sequence

from fastapi import Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session


def _hash_parts(parts: Iterable[object]) -> str:
    """Fold arbitrary parts into a short stable hex digest."""
    hasher = hashlib.md5(usedforsecurity=False)
    for part in parts:
        hasher.update(repr(part).encode("utf-8"))
        hasher.update(b"\x1f")  # unit separator to prevent boundary collisions
    return hasher.hexdigest()[:20]


def compute_user_etag(db: Session, user_id: int, models: Sequence[type]) -> str:
    """Produce a weak ETag summarizing the state of `models` for a single user.

    For each model, folds in `count(*)`, `max(created_at)`, and `max(updated_at)`
    where the column exists. Every mutation the user makes flips at least one of
    these three, so the ETag reliably invalidates on write.

    Passing multiple models composes their state — useful for aggregate reads
    like the net-worth chart that touch several tables.
    """
    parts: list[object] = [user_id, len(models)]
    for model in models:
        table = model.__table__
        has_user_id = "user_id" in table.c
        cols = [func.count()]
        if "created_at" in table.c:
            cols.append(func.max(table.c.created_at))
        if "updated_at" in table.c:
            cols.append(func.max(table.c.updated_at))
        query = db.query(*cols)
        if has_user_id:
            query = query.filter(table.c.user_id == user_id)
        row = query.one()
        parts.append(model.__name__)
        parts.extend(row)
    return _hash_parts(parts)


def check_etag(request: Request, etag: str) -> bool:
    """Return True when the client already has the current version (send 304)."""
    inm = request.headers.get("if-none-match")
    if not inm:
        return False
    # If-None-Match may be a comma-separated list. Compare against the weak form
    # we emit ("W/\"<hex>\"") plus the strong quoted form for tolerance.
    quoted = f'"{etag}"'
    weak = f'W/{quoted}'
    return any(token.strip() in (quoted, weak) for token in inm.split(","))


def set_etag_headers(response: Response, etag: str) -> None:
    """Attach the standard weak-ETag + Cache-Control pair to a mutable response."""
    response.headers["ETag"] = f'W/"{etag}"'
    # `no-cache` forces revalidation on every request but permits the browser
    # to store the last body and reuse it on a 304 — exactly what we want.
    response.headers["Cache-Control"] = "private, no-cache"
