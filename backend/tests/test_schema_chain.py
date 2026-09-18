"""A database built from the migration chain alone must match the ORM.

The boot-time repair list used to add columns that no revision knew about, so
a fresh Postgres built by Alembic could not even sign a user up. This pins
the chain to the models: every table and column the ORM maps exists after
`alembic upgrade head` on an empty database.
"""

from sqlalchemy import create_engine, inspect

from models.database import Base
from utils import migrations


def test_alembic_head_matches_the_orm(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'chain.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = create_engine(url)
    assert migrations.run_startup_migrations(engine) == migrations.OUTCOME_INITIALIZED

    inspector = inspect(engine)
    built = set(inspector.get_table_names()) - {"alembic_version"}
    assert set(Base.metadata.tables) <= built, sorted(set(Base.metadata.tables) - built)

    missing_columns = {}
    for name, table in Base.metadata.tables.items():
        have = {column["name"] for column in inspector.get_columns(name)}
        lost = [column.name for column in table.columns if column.name not in have]
        if lost:
            missing_columns[name] = lost
    assert missing_columns == {}, missing_columns
    engine.dispose()
