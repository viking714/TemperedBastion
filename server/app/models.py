"""SQLAlchemy ORM 模型：level_config / save_state / record。

列定义对齐 add.json.data_model.sqlite_tables；唯一偏差：``record.elapsed_ms`` 由 INTEGER
改为 REAL（理由见 ``Record`` 文档串）。三表均无用户维度（单机本地、无账号）。
"""

from __future__ import annotations

from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class LevelConfig(Base):
    """配置版本审计（append-only）：仅在 level.json 内容 hash 变更时新增一行。"""

    __tablename__ = "level_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class SaveState(Base):
    """存档槽（每槽一行，可覆盖）。state_json 承载全量快照。"""

    __tablename__ = "save_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slot: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    config_version: Mapped[str] = mapped_column(String(64), nullable=False)
    gold: Mapped[int] = mapped_column(Integer, nullable=False)
    lives: Mapped[int] = mapped_column(Integer, nullable=False)
    current_wave: Mapped[int] = mapped_column(Integer, nullable=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False)


class Record(Base):
    """战绩记录（每局结束一条）。

    说明：``elapsed_ms`` 存 **REAL**（浮点）而非 ADD ``data_model`` 写的 INTEGER ——
    与 ``save_state`` 端的同物理量（已游玩时长）保持一致，避免同一 API 面两端类型不一致
    （模拟为 1/60s 固定步长，毫秒为 16.666… 的整数倍，整型列会把小数毫秒截断）。
    SQLite 列类型是动态的，既有数据不受影响。
    """

    __tablename__ = "record"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 多用户化后归属的玩家；v1 时期的旧行为 NULL（由首位注册用户继承，见 routers/auth.py）。
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    wave_reached: Mapped[int] = mapped_column(Integer, nullable=False)
    lives_remaining: Mapped[int] = mapped_column(Integer, nullable=False)
    elapsed_ms: Mapped[float] = mapped_column(Float, nullable=False)
    config_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class User(Base):
    """玩家账号（注册即创建；口令以 PBKDF2 加盐哈希存储，明文不落库）。"""

    __tablename__ = "user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class AuthSession(Base):
    """登录会话：服务端令牌表 + HttpOnly Cookie（token 即主键）。"""

    __tablename__ = "auth_session"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(40), nullable=False)


class AutoSave(Base):
    """自动存档：每个用户一行（取代旧的手动多槽存档），随玩随存。"""

    __tablename__ = "autosave"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    config_version: Mapped[str] = mapped_column(String(64), nullable=False)
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False)
