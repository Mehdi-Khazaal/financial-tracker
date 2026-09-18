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
  (`alembic stamp <head>`), and the caller falls back to the legacy
  boot-time repairs so the service keeps working exactly as before.

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
                    action=f"run once against this database: alembic stamp {head}",
                    note="boot-time compatibility repairs stay active until then",
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
