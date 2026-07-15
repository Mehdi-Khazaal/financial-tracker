from fastapi import FastAPI
from fastapi.testclient import TestClient

from utils.security import BrowserOriginMiddleware


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(
        BrowserOriginMiddleware,
        allowed_origins=["https://financial.example"],
    )

    @app.post("/change")
    def change():
        return {"ok": True}

    return TestClient(app)


def test_cookie_authenticated_change_requires_trusted_origin():
    with _client() as client:
        client.cookies.set("access_token", "session")
        missing = client.post("/change")
        hostile = client.post("/change", headers={"Origin": "https://hostile.example"})
        trusted = client.post("/change", headers={"Origin": "https://financial.example"})

    assert missing.status_code == 403
    assert hostile.status_code == 403
    assert trusted.status_code == 200


def test_non_cookie_api_clients_are_not_treated_as_csrf_requests():
    with _client() as client:
        response = client.post("/change", headers={"Authorization": "Bearer api-token"})
        hostile_browser = client.post("/change", headers={"Origin": "https://hostile.example"})

    assert response.status_code == 200
    assert hostile_browser.status_code == 403
