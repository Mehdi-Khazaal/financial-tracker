import os
import json
from sqlalchemy.orm import Session

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@fintrack.app")


def send_push_to_user(db: Session, user_id: int, title: str, body: str, url: str = "/", tag: str = "fintrack"):
    if not VAPID_PRIVATE_KEY:
        return

    try:
        from pywebpush import webpush, WebPushException
        from models.push import PushSubscription

        subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
        payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})

        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=payload,
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": VAPID_SUBJECT},
                )
            except WebPushException as e:
                if e.response and e.response.status_code in (404, 410):
                    # Subscription expired — clean it up
                    db.delete(sub)
                    db.commit()
    except Exception as e:
        print(f"[Push] Error: {e}")
