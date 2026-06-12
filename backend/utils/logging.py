import logging
from typing import Any


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
    return logger


def kv(**fields: Any) -> str:
    parts = []
    for key, value in fields.items():
        if value is None:
            continue
        parts.append(f"{key}={value!r}")
    return " ".join(parts)
