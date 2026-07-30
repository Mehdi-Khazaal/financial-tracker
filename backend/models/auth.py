from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from models.database import Base, utc_now
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


MAX_PASSWORD_BYTES = 72


def _validate_password(value: str, *, require_strength: bool) -> str:
    if require_strength and len(value) < 8:
        raise ValueError("Password must be at least 8 characters")
    if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} UTF-8 bytes")
    return value

# ============ DATABASE MODEL ============
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False, server_default="false")
    is_admin = Column(Boolean, default=False, nullable=False, server_default="false")
    session_version = Column(Integer, default=0, nullable=False, server_default="0")
    # IANA zone reported by the browser. The server runs in UTC, so without this
    # the assistant's idea of "today" is wrong for anyone east or west of it.
    timezone = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utc_now)

# ============ PYDANTIC SCHEMAS ============
class UserCreate(BaseModel):
    email: EmailStr
    username: str = Field(min_length=1, max_length=100)
    password: str

    @field_validator("username")
    @classmethod
    def username_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Username is required")
        return value

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password(value, require_strength=True)

class UserLogin(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    password: str

    @field_validator("password")
    @classmethod
    def password_size(cls, value: str) -> str:
        return _validate_password(value, require_strength=False)

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    username: str
    is_verified: bool
    is_admin: bool
    created_at: datetime

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("current_password")
    @classmethod
    def current_password_size(cls, value: str) -> str:
        return _validate_password(value, require_strength=False)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password(value, require_strength=True)

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=4096)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password(value, require_strength=True)
