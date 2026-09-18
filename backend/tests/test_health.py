from sqlalchemy.exc import OperationalError

from models.database import get_db


def test_healthz_needs_nothing(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    # No auth, no cache, no body worth caching.
    assert response.headers.get("cache-control") is None or "no-store" in response.headers["cache-control"]


def test_readyz_reports_the_database(client):
    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "up"}


def test_readyz_is_503_when_the_database_does_not_answer(client):
    class Broken:
        def execute(self, *_args, **_kwargs):
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

        def close(self):
            pass

    def broken_db():
        yield Broken()

    # `client.app` is the very app the fixture serves; importing `conftest`
    # again would build a second one and re-run its setup.
    app = client.app
    previous = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = broken_db
    try:
        response = client.get("/readyz")
    finally:
        app.dependency_overrides[get_db] = previous

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "down"}
