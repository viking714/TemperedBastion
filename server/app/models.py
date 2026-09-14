"""SQLAlchemy ORM 模型：level_config / save_state / record。

列定义严格对齐 add.json.data_model.sqlite_tables。三表均无用户维度（单机本地、无账号）。
"""

from __future__ import annotations

from sqlalchemy import Integer, String, Text
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
    """战绩记录（每局结束一条）。"""

    __tablename__ = "record"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    wave_reached: Mapped[int] = mapped_column(Integer, nullable=False)
    lives_remaining: Mapped[int] = mapped_column(Integer, nullable=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    config_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
