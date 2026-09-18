"""Structured logs, request ids, and the optional error reporter."""

import json
import logging
import sys
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from utils import monitoring
from utils.logging import JsonFormatter, kv, request_id_var
from utils.request_context import RequestIdMiddleware, incoming_request_id


# ─── JSON formatter ───────────────────────────────────────────────────────────
def _record(message: str, level=logging.INFO, exc_info=None) -> logging.LogRecord:
    return logging.LogRecord("routers.plaid", level, "x.py", 1, message, None, exc_info)


def test_json_formatter_lifts_kv_pairs_into_fields():
    line = JsonFormatter().format(_record("plaid_sync_failed " + kv(item_id=7, user_id=3, error="boom 'quoted'")))
    payload = json.loads(line)

    assert payload["level"] == "INFO"
    assert payload["logger"] == "routers.plaid"
    assert payload["event"] == "plaid_sync_failed"
    assert payload["item_id"] == "7"
    assert payload["user_id"] == "3"
    assert payload["error"] == "boom 'quoted'"
    assert payload["ts"].endswith("+00:00")
    assert "request_id" not in payload


def test_json_formatter_includes_the_request_id_and_exceptions():
    token = request_id_var.set("req-123")
    try:
        try:
            raise ValueError("nope")
        except ValueError:
            line = JsonFormatter().format(_record("boom", logging.ERROR, sys.exc_info()))
    finally:
        request_id_var.reset(token)
    payload = json.loads(line)
    assert payload["request_id"] == "req-123"
    assert "ValueError: nope" in payload["exc"]


# ─── Request ids ──────────────────────────────────────────────────────────────
def test_incoming_request_id_is_kept_only_when_sane():
    assert incoming_request_id("abc-123_X.y") == "abc-123_X.y"
    generated = incoming_request_id("has spaces")
    assert len(generated) == 32 and generated != "has spaces"
    assert len(incoming_request_id("x" * 65)) == 32
    assert len(incoming_request_id(None)) == 32


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/thing")
    def thing():
        return {"request_id": request_id_var.get()}

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return TestClient(app)


def test_request_id_is_echoed_and_visible_inside_the_request(caplog):
    with _client() as client, caplog.at_level(logging.DEBUG):
        supplied = client.get("/thing", headers={"X-Request-ID": "trace-42"})
        generated = client.get("/thing")
        quiet = client.get("/healthz")

    assert supplied.headers["X-Request-ID"] == "trace-42"
    assert supplied.json()["request_id"] == "trace-42"
    assert len(generated.headers["X-Request-ID"]) == 32
    assert generated.json()["request_id"] == generated.headers["X-Request-ID"]
    assert quiet.status_code == 200
    # Outside a request the context is clean again.
    assert request_id_var.get() is None

    access = [r for r in caplog.records if r.getMessage().startswith("http_request")]
    assert any("path='/thing'" in r.getMessage() and "status=200" in r.getMessage() for r in access)
    health = [r for r in access if "path='/healthz'" in r.getMessage()]
    assert health and all(r.levelno == logging.DEBUG for r in health)


# ─── Sentry ───────────────────────────────────────────────────────────────────
def test_sentry_is_off_without_a_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert monitoring.sentry_enabled() is False
    assert monitoring.init_sentry() is False


def test_sentry_initialises_with_pii_off_when_configured(monkeypatch):
    calls = []
    monkeypatch.setitem(sys.modules, "sentry_sdk", SimpleNamespace(init=lambda **kw: calls.append(kw)))
    monkeypatch.setenv("SENTRY_DSN", "https://key@o0.ingest.sentry.io/1")
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "1.5")

    assert monitoring.init_sentry() is True
    assert calls[0]["dsn"].startswith("https://key@")
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["environment"] == "production"
    assert calls[0]["traces_sample_rate"] == 1.0  # clamped


def test_missing_sdk_with_a_dsn_is_a_warning_not_a_crash(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, "sentry_sdk", None)  # import raises ImportError
    monkeypatch.setenv("SENTRY_DSN", "https://key@o0.ingest.sentry.io/1")
    with caplog.at_level(logging.WARNING):
        assert monitoring.init_sentry() is False
    assert any("sentry_not_installed" in r.getMessage() for r in caplog.records)
