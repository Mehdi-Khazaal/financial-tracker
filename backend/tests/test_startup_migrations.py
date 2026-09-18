"""The boot-time migration switch, exercised against throwaway SQLite files."""


import pytest
from sqlalchemy import create_engine, inspect

from models.database import Base
from utils import migrations


@pytest.fixture
def scratch(monkeypatch, tmp_path):
    """A fresh SQLite file that Alembic's env.py will pick up via DATABASE_URL."""
    path = tmp_path / "boot.db"
    url = f"sqlite:///{path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.delenv("RUN_MIGRATIONS_ON_BOOT", raising=False)
    engine = create_engine(url)
    yield engine
    engine.dispose()


def test_fresh_database_is_built_by_alembic(scratch):
    outcome = migrations.run_startup_migrations(scratch)

    assert outcome == migrations.OUTCOME_INITIALIZED
    assert migrations.current_revision(scratch) == migrations.head_revision()
    tables = set(inspect(scratch).get_table_names())
    assert {"users", "transactions", "auth_failures", "assistant_pending_actions"} <= tables


def test_unstamped_database_is_left_alone_with_instructions(scratch, caplog):
    Base.metadata.create_all(bind=scratch)  # tables, but no alembic_version — production today

    outcome = migrations.run_startup_migrations(scratch)

    assert outcome == migrations.OUTCOME_UNSTAMPED
    assert migrations.current_revision(scratch) is None
    assert any("alembic stamp" in record.getMessage() for record in caplog.records)
    # The baseline, never head: stamping head would skip the column-adding revisions.
    assert any(migrations.PRODUCTION_BASELINE in record.getMessage() for record in caplog.records)
    assert not any(f"alembic stamp {migrations.head_revision()}" in record.getMessage() for record in caplog.records)


def test_stamped_database_is_upgraded_to_head(scratch):
    from alembic import command

    command.upgrade(migrations.alembic_config(), "20260917_000015")
    assert "assistant_pending_actions" not in inspect(scratch).get_table_names()

    outcome = migrations.run_startup_migrations(scratch)

    assert outcome == migrations.OUTCOME_UPGRADED
    assert migrations.current_revision(scratch) == migrations.head_revision()
    assert "assistant_pending_actions" in inspect(scratch).get_table_names()


def test_switch_can_be_disabled(scratch, monkeypatch):
    monkeypatch.setenv("RUN_MIGRATIONS_ON_BOOT", "false")
    assert migrations.run_startup_migrations(scratch) == migrations.OUTCOME_DISABLED
    assert inspect(scratch).get_table_names() == []


def test_a_broken_migration_reports_failed_instead_of_crashing(scratch, monkeypatch):
    def explode(*_a, **_k):
        raise RuntimeError("boom")

    real_command, real_config, real_script = migrations._alembic()
    monkeypatch.setattr(migrations, "_alembic", lambda: (type("C", (), {"upgrade": staticmethod(explode)}), real_config, real_script))
    assert migrations.run_startup_migrations(scratch) == migrations.OUTCOME_FAILED


def test_missing_alembic_reports_unavailable_instead_of_crashing(scratch, monkeypatch):
    def no_alembic():
        raise ImportError("No module named 'alembic'")

    monkeypatch.setattr(migrations, "_alembic", no_alembic)
    assert migrations.run_startup_migrations(scratch) == migrations.OUTCOME_UNAVAILABLE
    assert inspect(scratch).get_table_names() == []


# ─── Schema verification after boot ───────────────────────────────────────────
def test_the_baseline_is_a_real_revision_before_head(scratch):
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(migrations.alembic_config())
    revisions = [rev.revision for rev in script.walk_revisions()]
    assert migrations.PRODUCTION_BASELINE in revisions
    assert migrations.PRODUCTION_BASELINE != migrations.head_revision()


def test_schema_gaps_names_missing_tables_and_columns(scratch):
    from sqlalchemy import text

    with scratch.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR, username VARCHAR)"))
    missing = migrations.schema_gaps(scratch)
    assert "users.totp_secret" in missing and "users.hashed_password" in missing
    assert "transactions" in missing


def test_a_built_database_has_no_gaps(scratch):
    assert migrations.run_startup_migrations(scratch) == migrations.OUTCOME_INITIALIZED
    assert migrations.schema_gaps(scratch) == []


def test_health_refuses_traffic_when_the_schema_is_behind(client, monkeypatch):
    monkeypatch.setitem(migrations.SCHEMA_STATE, "missing", ["users.totp_secret"])
    assert client.get("/healthz").status_code == 503
    assert client.get("/healthz").json() == {"status": "unavailable", "schema": "behind"}
    assert client.get("/readyz").status_code == 503
    monkeypatch.setitem(migrations.SCHEMA_STATE, "missing", [])
    assert client.get("/healthz").status_code == 200


def test_an_unreachable_database_at_boot_does_not_block(monkeypatch):
    class Broken:
        def connect(self):
            raise OSError("down")

    monkeypatch.setitem(migrations.SCHEMA_STATE, "missing", [])
    assert migrations.record_schema_state(Broken()) is None
    assert migrations.SCHEMA_STATE["missing"] == []
