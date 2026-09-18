"""Request/response bodies for the Plaid routes."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ExchangeTokenRequest(BaseModel):
    public_token: str
    institution_name: Optional[str] = None


class PlaidItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    institution_name: Optional[str]
    created_at: datetime
