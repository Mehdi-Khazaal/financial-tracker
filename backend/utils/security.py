from collections.abc import Iterable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class BrowserOriginMiddleware(BaseHTTPMiddleware):
    """Reject cross-site state changes authenticated by browser cookies."""

    def __init__(self, app, allowed_origins: Iterable[str]):
        super().__init__(app)
        self.allowed_origins = {origin.rstrip("/") for origin in allowed_origins}

    async def dispatch(self, request: Request, call_next):
        has_auth_cookie = bool(
            request.cookies.get("access_token") or request.cookies.get("refresh_token")
        )
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = (request.headers.get("origin") or "").rstrip("/")
            request_origin = f"{request.url.scheme}://{request.url.netloc}".rstrip("/")
            allowed = self.allowed_origins | {request_origin}
            if (has_auth_cookie and not origin) or (origin and origin not in allowed):
                return JSONResponse(status_code=403, content={"detail": "Untrusted request origin"})
        return await call_next(request)
