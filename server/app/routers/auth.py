"""POST /api/auth/* —— 注册 / 登录 / 登出 / 会话查询。

注册即自动登录（下发会话 Cookie）；口令不落库（PBKDF2 加盐哈希）。
多用户化迁移：**首位注册用户**会继承 v1 时期（无账号时代）的匿名战绩。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..auth import SESSION_COOKIE, SESSION_TTL_DAYS, hash_password, issue_session, require_user, verify_password
from ..db import get_db
from ..models import Record, User
from ..schemas import ApiError, LoginRequest, OkResponse, RegisterRequest, UserOut
from ..seed import now_iso

router = APIRouter(prefix="/auth", tags=["auth"])

_COOKIE_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _to_out(user: User) -> UserOut:
    return UserOut(id=int(user.id), username=user.username, createdAt=user.created_at)


@router.post("/register", status_code=201, response_model=UserOut)
def register(
    payload: RegisterRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    # 用户名唯一（大小写不敏感）：统一小写比较，存储保留原样。
    existing = db.execute(
        select(User).where(func.lower(User.username) == payload.username.lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise ApiError(409, "USERNAME_TAKEN", "用户名已被占用，换一个试试")

    is_first_user = (db.execute(select(func.count()).select_from(User)).scalar() or 0) == 0

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        created_at=now_iso(),
    )
    db.add(user)
    db.flush()  # 拿到自增 id

    if is_first_user:
        # 首位用户继承 v1 时代的匿名战绩（多用户化的一次性迁移）。
        db.execute(update(Record).where(Record.user_id.is_(None)).values(user_id=user.id))

    token = issue_session(db, user)
    db.commit()

    _set_session_cookie(response, token)
    return _to_out(user)


@router.post("/login", response_model=UserOut)
def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    user = db.execute(
        select(User).where(func.lower(User.username) == payload.username.lower())
    ).scalar_one_or_none()
    # 用户不存在与口令错误统一返回同一错误，避免用户名探测。
    if user is None or not verify_password(payload.password, user.password_hash):
        raise ApiError(401, "INVALID_CREDENTIALS", "用户名或密码不正确")

    token = issue_session(db, user)
    db.commit()
    _set_session_cookie(response, token)
    return _to_out(user)


@router.post("/logout", response_model=OkResponse)
def logout(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_user)],
) -> OkResponse:
    from ..models import AuthSession  # 局部导入避免循环

    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete()
    db.commit()
    response.delete_cookie(key=SESSION_COOKIE, path="/")
    return OkResponse(ok=True)


@router.get("/me", response_model=UserOut)
def me(user: Annotated[User, Depends(require_user)]) -> UserOut:
    return _to_out(user)
