import json
import os

from sqlalchemy.orm import Session

from utils.logging import get_logger, kv

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@fintrack.app")

logger = get_logger(__name__)


def send_push_to_user(db: Session, user_id: int, title: str, body: str, url: str = "/", tag: str = "fintrack"):
    if not VAPID_PRIVATE_KEY:
        logger.info("push_delivery_skipped %s", kv(reason="missing_vapid_private_key", user_id=user_id, tag=tag))
        return

    try:
        from pywebpush import WebPushException, webpush
        from models.push import PushSubscription
    except Exception:
        logger.exception("push_dependency_load_failed %s", kv(user_id=user_id, tag=tag))
        return

    try:
        subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
        if not subs:
            logger.info("push_delivery_skipped %s", kv(reason="no_subscriptions", user_id=user_id, tag=tag))
            return

        payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
        expired_subscriptions = []

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
            except WebPushException as exc:
                status_code = exc.response.status_code if exc.response else None
                if status_code in (404, 410):
                    expired_subscriptions.append(sub)
                    logger.info(
                        "push_subscription_expired %s",
                        kv(user_id=user_id, endpoint=sub.endpoint, status_code=status_code),
                    )
                else:
                    logger.warning(
                        "push_delivery_failed %s",
                        kv(user_id=user_id, endpoint=sub.endpoint, status_code=status_code),
                    )

        if expired_subscriptions:
            for sub in expired_subscriptions:
                db.delete(sub)
            db.commit()

        logger.info(
            "push_delivery_completed %s",
            kv(user_id=user_id, tag=tag, subscriptions=len(subs), expired=len(expired_subscriptions)),
        )
    except Exception:
        logger.exception("push_delivery_unexpected_error %s", kv(user_id=user_id, tag=tag))
