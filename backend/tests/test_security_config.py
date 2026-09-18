"""Environment-driven security configuration: docs exposure, origins, headers."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from utils.security import (
    DOCS_CSP,
    SecurityHeadersMiddleware,
    allowed_browser_origins,
    api_docs_enabled,
    security_headers,
)


# ─── API docs ─────────────────────────────────────────────────────────────────
def test_docs_are_on_outside_production(monkeypatch):
    monkeypatch.delenv("EXPOSE_API_DOCS", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert api_docs_enabled() is True
    monkeypatch.setenv("ENVIRONMENT", "test")
    assert api_docs_enabled() is True


def test_docs_are_off_in_production_unless_opted_in(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("EXPOSE_API_DOCS", raising=False)
    assert api_docs_enabled() is False
    monkeypatch.setenv("EXPOSE_API_DOCS", "true")
    assert api_docs_enabled() is True
    monkeypatch.setenv("EXPOSE_API_DOCS", "false")
    assert api_docs_enabled() is False


def test_docs_can_be_forced_off_anywhere(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("EXPOSE_API_DOCS", "0")
    assert api_docs_enabled() is False


# ─── Origins ──────────────────────────────────────────────────────────────────
def test_origins_merge_defaults_env_csv_and_legacy_single_value(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://app.example.com/, https://preview.example.com ,, https://app.example.com")
    monkeypatch.setenv("EXTRA_ALLOWED_ORIGIN", "https://legacy.example.com/")

    origins = allowed_browser_origins(["http://localhost:3000"])

    assert origins == [
        "http://localhost:3000",
        "https://legacy.example.com",
        "https://app.example.com",
        "https://preview.example.com",
    ]


def test_origins_without_env_are_just_the_defaults(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("EXTRA_ALLOWED_ORIGIN", raising=False)
    assert allowed_browser_origins(["http://localhost:3000"]) == ["http://localhost:3000"]


# ─── Headers ──────────────────────────────────────────────────────────────────
def _client() -> TestClient:
    app = FastAPI(docs_url="/docs")
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/thing")
    def thing():
        return {"ok": True}

    return TestClient(app)


def test_every_response_carries_the_security_headers(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    with _client() as client:
        response = client.get("/thing")

    assert response.headers["Cache-Control"] == "no-store, no-cache, must-revalidate, max-age=0"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert response.headers["Cross-Origin-Resource-Policy"] == "same-site"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert response.headers["Content-Security-Policy"].startswith("default-src 'none'")
    assert "Strict-Transport-Security" not in response.headers


def test_hsts_only_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert security_headers()["Strict-Transport-Security"].startswith("max-age=63072000")
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert "Strict-Transport-Security" not in security_headers()
    assert "Strict-Transport-Security" in security_headers(production=True)


def test_docs_page_gets_a_policy_that_lets_swagger_render(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    with _client() as client:
        response = client.get("/docs")

    assert response.status_code == 200
    assert response.headers["Content-Security-Policy"] == DOCS_CSP
    assert "cdn.jsdelivr.net" in DOCS_CSP
