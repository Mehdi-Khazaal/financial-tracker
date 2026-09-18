"""The linked-bank connection row."""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from models.database import Base, utc_now


class PlaidItem(Base):
    """A linked bank connection, plus a small record of how syncing is going.

    The health columns exist because the audit could not answer a basic
    question: when did Fintrack last *receive* anything for this Item? Plaid's
    `/item/get` reports when Plaid last *sent* a webhook; only our own record
    can say whether it arrived. The gap between those two answers is precisely
    how a delivery problem is distinguished from a registration problem.

    Every health column is nullable and best-effort. Writing them must never
    be able to fail a sync — see `record_sync_health`.
    """

    __tablename__ = "plaid_items"

    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    access_token     = Column(Text, nullable=False)
    item_id          = Column(String(200), nullable=False, unique=True)
    institution_name = Column(String(200), nullable=True)
    cursor           = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=utc_now)

    # ── Sync health (observability only; never read by sync logic) ───────────
    # When Fintrack received a webhook for this Item, and which code it was.
    last_webhook_at      = Column(DateTime, nullable=True)
    last_webhook_code    = Column(String(60), nullable=True)
    # When a sync last ran, what triggered it, and whether it finished.
    last_sync_at         = Column(DateTime, nullable=True)
    last_sync_source     = Column(String(20), nullable=True)  # webhook | manual | other
    last_sync_ok         = Column(Boolean, nullable=True)
    # Short, safe error summary. Never a Plaid payload, never a credential.
    last_sync_error      = Column(String(300), nullable=True)
    last_added_count     = Column(Integer, nullable=True)
    last_modified_count  = Column(Integer, nullable=True)
    last_removed_count   = Column(Integer, nullable=True)
