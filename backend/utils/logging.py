"""Logging for the API: one line per event, optionally as JSON, always with the
request id when there is one.

`LOG_FORMAT=json` switches every record to a single JSON object per line —
what Render's log drain and any aggregator parse without regexes. The default
stays the human-readable text format used until now, so nothing changes for
local development unless asked.

`kv()` renders structured fields into the message the way the codebase has
always done (`key='value' key2=3`); under JSON those pairs are *also* lifted
into top-level fields so they can be filtered on.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any

# Set by `RequestIdMiddleware` for the lifetime of one request; background
# work started from a request inherits it through the context.
request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

_KV_PATTERN = re.compile(r"(\w+)=('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|\S+)")
_configured = False


def _parse_kv(message: str) -> dict[str, Any]:
    """Recover `key=value` pairs written by `kv()` from a message string."""
    fields: dict[str, Any] = {}
    for key, raw in _KV_PATTERN.findall(message):
        if raw[:1] in "'\"" and raw[-1:] == raw[:1]:
            raw = raw[1:-1]
        fields[key] = raw
    return fields


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": message,
        }
        request_id = request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        # The event name is the first token; the pairs after it become fields.
        head, _, tail = message.partition(" ")
        if tail and "=" in tail:
            payload["event"] = head
            payload.update(_parse_kv(tail))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        request_id = request_id_var.get()
        return f"{base} request_id={request_id}" if request_id else base


def log_format() -> str:
    return "json" if os.getenv("LOG_FORMAT", "text").strip().lower() == "json" else "text"


def configure_logging(*, force: bool = False) -> None:
    """Install the root handler once. Safe to call from every module."""
    global _configured
    if _configured and not force:
        return
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(sys.stderr)
    if log_format() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(TextFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    level_name = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    root.setLevel(getattr(logging, level_name, logging.INFO))
    _configured = True


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)


def kv(**fields: Any) -> str:
    parts = []
    for key, value in fields.items():
        if value is None:
            continue
        parts.append(f"{key}={value!r}")
    return " ".join(parts)
