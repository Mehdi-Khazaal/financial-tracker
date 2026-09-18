import os
from collections.abc import Iterable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


def is_production() -> bool:
    return os.getenv("ENVIRONMENT", "").strip().lower() == "production"


def api_docs_enabled() -> bool:
    """Whether Swagger, ReDoc and the OpenAPI document are served.

    On by default everywhere except production, where the schema is a map for
    anyone probing the API and nothing in the product needs it. `EXPOSE_API_DOCS=true`
    turns it back on deliberately.
    """
    override = os.getenv("EXPOSE_API_DOCS", "").strip().lower()
    if override in {"true", "1", "yes"}:
        return True
    if override in {"false", "0", "no"}:
        return False
    return not is_production()


def allowed_browser_origins(defaults: Iterable[str]) -> list[str]:
    """The origins that may make credentialed, state-changing requests.

    `defaults` are the origins the code has always trusted. `ALLOWED_ORIGINS`
    (comma-separated) adds more — a custom domain, a Vercel preview — without a
    code change, and the legacy single-value `EXTRA_ALLOWED_ORIGIN` is still
    honoured so an existing deployment keeps working unchanged.
    """
    seen: list[str] = []
    candidates = list(defaults)
    candidates.append(os.getenv("EXTRA_ALLOWED_ORIGIN", ""))
    candidates.extend(os.getenv("ALLOWED_ORIGINS", "").split(","))
    for raw in candidates:
        origin = (raw or "").strip().rstrip("/")
        if origin and origin not in seen:
            seen.append(origin)
    return seen


def security_headers(*, production: bool | None = None) -> dict[str, str]:
    """Response headers every API reply carries.

    The API serves JSON only, so the policy is the strictest one that still
    lets Swagger render where it is enabled: nothing may be framed, nothing is
    cached, and — mirroring the front end's own CSP — nothing embedded here may
    load a script from anywhere. HSTS is production-only because the local
    dev server is plain HTTP.
    """
    if production is None:
        production = is_production()
    headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-site",
        # JSON responses render nothing; the docs pages are the only HTML and
        # they need their own inline script/style from the Swagger CDN.
        "Content-Security-Policy": (
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        ),
    }
    if production:
        headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return headers


DOCS_CSP = (
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data: https://fastapi.tiangolo.com; "
    "frame-ancestors 'none'; base-uri 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach `security_headers()` to every response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for name, value in security_headers().items():
            response.headers[name] = value
        if request.url.path in {"/docs", "/redoc"} or request.url.path.startswith("/docs/"):
            response.headers["Content-Security-Policy"] = DOCS_CSP
        return response


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
