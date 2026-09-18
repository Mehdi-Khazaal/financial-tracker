"""Fail when a database migrated to head differs from the models.

    DATABASE_URL=postgresql://... alembic upgrade head
    DATABASE_URL=postgresql://... python scripts/check_schema_drift.py

Production was built from the models (the legacy boot-time repairs); fresh
databases are built by the migration chain. This keeps the two the same:
tables, columns, types, indexes and foreign keys are compared (Alembic's
autogenerate comparison with `compare_type`). Server defaults are not — the
chain declares them for existing rows, the models use Python-side defaults,
and the two mean the same thing to the application.

Run it against Postgres; SQLite reflects too little (types, some constraints)
for the comparison to be meaningful. Never point it at production.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402


def _flatten(diffs):
    for diff in diffs:
        if isinstance(diff, list):
            yield from _flatten(diff)
        else:
            yield diff


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    if not url.startswith("postgres"):
        print("check_schema_drift: set DATABASE_URL to a scratch Postgres database migrated to head")
        return 2
    import main as app_module  # noqa: F401  registers every model on Base.metadata
    from models.database import Base

    engine = create_engine(url)
    with engine.connect() as conn:
        context = MigrationContext.configure(conn, opts={"compare_type": True, "compare_server_default": False})
        diffs = list(_flatten(compare_metadata(context, Base.metadata)))
    for diff in diffs:
        print(f"DRIFT {diff[0]}: {diff[1:]}")
    print(f"{len(diffs)} difference(s) between the migration chain and the models")
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main())
