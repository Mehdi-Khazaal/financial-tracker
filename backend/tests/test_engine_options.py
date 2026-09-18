from models.database import engine_options


def test_sqlite_gets_no_pool_tuning():
    assert engine_options("sqlite:///./x.db") == {}
    assert engine_options("sqlite://") == {}


def test_postgres_gets_a_small_recycled_pool_and_timeouts(monkeypatch):
    for name in ("DB_POOL_SIZE", "DB_MAX_OVERFLOW", "DB_POOL_RECYCLE_SECONDS", "DB_POOL_TIMEOUT_SECONDS", "DB_STATEMENT_TIMEOUT_MS", "DB_CONNECT_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)

    options = engine_options("postgresql://u:p@ep-pooler.neon.tech/db")

    assert options["pool_pre_ping"] is True
    assert options["pool_size"] == 5
    assert options["max_overflow"] == 5
    assert options["pool_recycle"] == 300
    assert options["pool_timeout"] == 10
    assert options["connect_args"]["connect_timeout"] == 10
    assert options["connect_args"]["options"] == "-c statement_timeout=15000"
    assert options["connect_args"]["keepalives"] == 1


def test_pool_settings_are_env_overridable(monkeypatch):
    monkeypatch.setenv("DB_POOL_SIZE", "2")
    monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", "5000")
    monkeypatch.setenv("DB_POOL_RECYCLE_SECONDS", "not-a-number")

    options = engine_options("postgresql+psycopg2://u:p@host/db")

    assert options["pool_size"] == 2
    assert options["pool_recycle"] == 300  # bad value falls back to the default
    assert options["connect_args"]["options"] == "-c statement_timeout=5000"
