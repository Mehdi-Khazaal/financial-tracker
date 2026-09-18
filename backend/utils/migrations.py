"""Alembic at boot — the one path that changes the production schema.

History: the schema used to be kept in step by `main._prepare_database()`, a
list of `CREATE TABLE`/`ALTER TABLE … IF NOT EXISTS` statements run on every
start, mirrored by hand in Alembic revisions that nothing ever applied. Two
sources of truth, one of them unversioned.

This module makes Alembic authoritative while keeping every existing
deployment safe:

* **Fresh database** (no tables at all): `alembic upgrade head` builds it.
* **Stamped database** (`alembic_version` present): `alembic upgrade head`
  applies whatever is pending. This is the steady state.
* **Unstamped database with tables** — production today: nothing is
  changed, a warning names the one-time command to run
  (`alembic stamp 20260916_000013`, the `PRODUCTION_BASELINE` below — *not*
  head), and the caller falls back to the legacy boot-time repairs.

After either path, `record_schema_state` compares the models with the live
database once. If columns the code needs are missing — a deploy that ran
before the stamp — `/healthz` answers 503, so the platform keeps the previous
release serving instead of promoting one that would fail every request.

`RUN_MIGRATIONS_ON_BOOT=false` turns the whole thing off for operators who
run migrations as a deploy step instead.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from utils.logging import get_logger, kv

logger = get_logger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]

# The last revision on `main` before the Fintrack upgrade branch (1843c6d).
# Production was built to exactly this schema by the legacy boot-time repairs,
# so it is the revision to stamp production at; the next boot then applies
# everything after it. Stamping at head instead would record the
# column-adding revisions (2FA, splits, import batches, alerts…) as applied
# when they never ran.
PRODUCTION_BASELINE = "20260916_000013"

# Filled once at boot by `record_schema_state`; read by the health routes.
SCHEMA_STATE: dict = {"checked": False, "missing": []}

OUTCOME_DISABLED = "disabled"
OUTCOME_INITIALIZED = "initialized"
OUTCOME_UPGRADED = "upgraded"
OUTCOME_UNSTAMPED = "unstamped"
OUTCOME_UNAVAILABLE = "unavailable"
OUTCOME_FAILED = "failed"


def _alembic():
    """Import Alembic on demand.

    It is a hard requirement (`requirements.txt`), but a process that somehow
    lacks it must still boot on the legacy path rather than die at import —
    the service is worth more than the upgrade step.
    """
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    return command, Config, ScriptDirectory


def alembic_config():
    _, Config, _ = _alembic()
    # Deliberately *not* loading alembic.ini: its `[loggers]` section would
    # make env.py call `logging.config.fileConfig`, which replaces the
    # process's log handlers (and, by default, silences every logger created
    # before it). The CLI keeps that behaviour; in-process runs keep ours.
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return cfg


def head_revision() -> str:
    _, _, ScriptDirectory = _alembic()
    return ScriptDirectory.from_config(alembic_config()).get_current_head() or ""


def current_revision(engine: Engine) -> Optional[str]:
    with engine.connect() as conn:
        if not inspect(conn).has_table("alembic_version"):
            return None
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def migrations_enabled() -> bool:
    return os.getenv("RUN_MIGRATIONS_ON_BOOT", "true").strip().lower() != "false"


def run_startup_migrations(engine: Engine) -> str:
    """Bring the schema to head where that is safe. Returns an outcome name.

    Never raises: a migration problem at boot is logged at ERROR and reported
    as `failed`, so the caller can decide whether the legacy path should run.
    A service that fails to start because a migration is broken would not be
    better than one that starts and reports it.
    """
    if not migrations_enabled():
        logger.info("startup_migrations_disabled")
        return OUTCOME_DISABLED

    try:
        command, _, _ = _alembic()
    except ImportError:
        logger.error("startup_migrations_unavailable %s", kv(hint="pip install -r requirements.txt"))
        return OUTCOME_UNAVAILABLE

    try:
        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = set(inspector.get_table_names())
        stamped = "alembic_version" in tables
        head = head_revision()

        if not stamped and tables:
            logger.warning(
                "database_not_stamped %s",
                kv(
                    head=head,
                    action=f"run once against this database: alembic stamp {PRODUCTION_BASELINE}, then restart",
                    note="the restart applies every revision after the baseline; do not stamp head",
                ),
            )
            return OUTCOME_UNSTAMPED

        before = current_revision(engine)
        command.upgrade(alembic_config(), "head")
        after = current_revision(engine)
        outcome = OUTCOME_INITIALIZED if not stamped else OUTCOME_UPGRADED
        logger.info("startup_migrations_applied %s", kv(outcome=outcome, before=before, after=after))
        return outcome
    except Exception as exc:
        logger.error("startup_migrations_failed %s", kv(error_type=type(exc).__name__, error=str(exc)[:300]))
        return OUTCOME_FAILED


def schema_gaps(engine: Engine) -> list[str]:
    """Tables and columns the models expect that the database does not have."""
    from models.database import Base

    missing: list[str] = []
    with engine.connect() as conn:
        inspector = inspect(conn)
        existing = set(inspector.get_table_names())
        for table in Base.metadata.sorted_tables:
            if table.name not in existing:
                missing.append(table.name)
                continue
            present = {column["name"] for column in inspector.get_columns(table.name)}
            missing.extend(f"{table.name}.{column.name}" for column in table.columns if column.name not in present)
    return missing


def record_schema_state(engine: Engine) -> Optional[list[str]]:
    """Check the schema once at boot and remember the answer for `/healthz`.

    Only a positive finding blocks: if the check itself cannot run (the
    database is unreachable at boot), the state stays "unchecked" and health
    stays green — an outage elsewhere is not a reason to fail a deploy.
    """
    try:
        missing = schema_gaps(engine)
    except Exception as exc:
        logger.warning("schema_check_unavailable %s", kv(error_type=type(exc).__name__))
        SCHEMA_STATE.update(checked=False, missing=[])
        return None
    SCHEMA_STATE.update(checked=True, missing=missing)
    if missing:
        logger.error(
            "schema_behind_code %s",
            kv(
                count=len(missing),
                missing=",".join(missing[:20]),
                action=f"if this database was built by the legacy repairs: alembic stamp {PRODUCTION_BASELINE}, then restart",
            ),
        )
    return missing
