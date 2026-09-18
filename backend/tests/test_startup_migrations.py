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
