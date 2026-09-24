"""认证工具：口令哈希（PBKDF2-SHA256 + 随机盐）+ 服务端会话 + FastAPI 依赖。

设计取舍：
- 不引第三方加密依赖（bcrypt 等）：Python 标准库 hashlib.pbkdf2_hmac 已足够；
  存储格式 ``pbkdf2$<iterations>$<salt_hex>$<digest_hex>`` 便于日后可平滑升级迭代次数/算法。
- 会话令牌为 256bit 随机值，存服务端 auth_session 表，通过 HttpOnly + SameSite=Lax 的
  Cookie 下发（同源 fetch 自动携带；无 CORS / 无 localStorage 令牌泄露面）。
- ``require_user`` 依赖用于需要登录的路由（自动存档 / 战绩）。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Cookie, Depends
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuthSession, User
from .schemas import ApiError
from .seed import now_iso

SESSION_COOKIE = "td_session"
SESSION_TTL_DAYS = 30
PBKDF2_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2":
            return False
        check = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
        ).hex()
        return hmac.compare_digest(check, digest)
    except (ValueError, TypeError):
        return False


def issue_session(db: Session, user: User) -> str:
    """创建会话并返回令牌（调用方负责 commit + 下发 Cookie）。"""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=SESSION_TTL_DAYS)
    db.add(
        AuthSession(
            token=token,
            user_id=user.id,
            created_at=now_iso(),
            expires_at=expires.isoformat(),
        )
    )
    return token


def resolve_user(db: Session, token: str | None) -> User | None:
    """按会话令牌取用户；令牌不存在/过期返回 None（过期会话顺手删除）。"""
    if not token:
        return None
    session = db.get(AuthSession, token)
    if session is None:
        return None
    if session.expires_at <= datetime.now(timezone.utc).isoformat():
        db.delete(session)
        db.commit()
        return None
    user = db.get(User, session.user_id)
    return user


def require_user(
    db: Annotated[Session, Depends(get_db)],
    td_session: Annotated[str | None, Cookie()] = None,
) -> User:
    """路由依赖：未登录 → 401 UNAUTHENTICATED。"""
    user = resolve_user(db, td_session)
    if user is None:
        raise ApiError(401, "UNAUTHENTICATED", "请先登录后再访问")
    return user
