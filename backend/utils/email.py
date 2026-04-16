import os
import requests

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FROM_EMAIL = os.getenv("FROM_EMAIL", "noreply@fintrack.app")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


def _send(to: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY:
        print(f"[Email] RESEND_API_KEY not set — would send '{subject}' to {to}")
        return False
    resp = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
        json={"from": FROM_EMAIL, "to": [to], "subject": subject, "html": html},
        timeout=10,
    )
    if not resp.ok:
        print(f"[Email] Resend error {resp.status_code}: {resp.text}")
    return resp.ok


def send_password_reset(email: str, token: str):
    url = f"{FRONTEND_URL}/reset-password?token={token}"
    _send(
        to=email,
        subject="Reset your Fintrack password",
        html=f"""
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2>Password Reset</h2>
          <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
          <a href="{url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
          <p style="color:#888;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
        </div>
        """,
    )


def send_verification(email: str, token: str):
    url = f"{FRONTEND_URL}/verify-email?token={token}"
    _send(
        to=email,
        subject="Verify your Fintrack email",
        html=f"""
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2>Verify your email</h2>
          <p>Welcome to Fintrack! Click the button below to verify your email address.</p>
          <a href="{url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Verify Email</a>
          <p style="color:#888;font-size:12px;margin-top:24px">This link expires in 24 hours.</p>
        </div>
        """,
    )
