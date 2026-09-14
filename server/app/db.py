"""SQLite 引擎 / 会话 / 声明式基类。

数据库文件位置可通过环境变量 ``TD_DB_PATH`` 覆盖（测试用临时库），
默认落在 ``server/data/tower_defense.db``。
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

_SERVER_DIR = Path(__file__).resolve().parent.parent


def database_path() -> Path:
    """当前生效的 SQLite 文件路径（可被 TD_DB_PATH 覆盖）。"""
    override = os.environ.get("TD_DB_PATH")
    if override:
        return Path(override)
    return _SERVER_DIR / "data" / "tower_defense.db"


class Base(DeclarativeBase):
    """所有 ORM 模型的声明式基类。"""


_engine = None
_SessionLocal: sessionmaker[Session] | None = None
_engine_url: str | None = None


def _ensure_engine():
    global _engine, _SessionLocal, _engine_url
    db_path = database_path()
    url = f"sqlite:///{db_path.as_posix()}"
    if _engine is None or _engine_url != url:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        if _engine is not None:
            _engine.dispose()
        _engine = create_engine(
            url,
            connect_args={"check_same_thread": False},
            future=True,
        )
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, future=True)
        _engine_url = url
    return _engine


def get_engine():
    """惰性获取引擎（首次调用时才建目录与连接池）。"""
    return _ensure_engine()


def get_session_factory() -> sessionmaker[Session]:
    _ensure_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def init_db() -> None:
    """建表（幂等）。"""
    from . import models  # noqa: F401  确保模型已注册到 Base.metadata

    Base.metadata.create_all(bind=get_engine())


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：每请求一个会话。"""
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()
