"""API responses are compressed, so the full transaction history is cheap to download."""

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.testclient import TestClient

import main


def test_the_app_compresses_and_keeps_the_request_id_outermost():
    names = [m.cls.__name__ for m in main.app.user_middleware]
    assert "GZipMiddleware" in names
    gzip = next(m for m in main.app.user_middleware if m.cls is GZipMiddleware)
    assert gzip.kwargs["minimum_size"] == 1024
    assert names[0] == "RequestIdMiddleware"


def test_large_json_is_gzipped_and_small_json_is_not():
    app = FastAPI()
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.get("/big")
    def big():
        return [{"id": i, "description": "WHOLE FOODS MKT", "amount": "-12.34"} for i in range(500)]

    @app.get("/small")
    def small():
        return {"ok": True}

    client = TestClient(app)
    big_response = client.get("/big", headers={"Accept-Encoding": "gzip"})
    assert big_response.headers["content-encoding"] == "gzip"
    assert len(big_response.json()) == 500
    assert "content-encoding" not in client.get("/small", headers={"Accept-Encoding": "gzip"}).headers
