import os

from slowapi import Limiter
from slowapi.util import get_remote_address


# Disable rate limiting when RATE_LIMIT_ENABLED=false. Used by the Playwright
# smoke suite which registers many users in quick succession.
_enabled = os.getenv("RATE_LIMIT_ENABLED", "true").lower() != "false"

limiter = Limiter(key_func=get_remote_address, enabled=_enabled)
