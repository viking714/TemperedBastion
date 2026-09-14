"""启动时把 level.json 的版本同步进 level_config 审计表（append-only）。

- 未见过的 config_hash → 新增一行，version = max+1，并置为唯一 active。
- 已存在的 hash → 仅把它置回 active（例如切换到旧配置版本）。
不参与运行期热路径：GET /api/config 直接读文件。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .config_loader import load_config
from .models import LevelConfig


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sync_config_version(db: Session, config: dict | None = None) -> int:
    payload = config if config is not None else load_config()
    digest = str(payload["version"])

    db.execute(update(LevelConfig).values(is_active=0))
    existing = db.execute(select(LevelConfig).where(LevelConfig.config_hash == digest)).scalar_one_or_none()

    if existing is not None:
        existing.is_active = 1
        db.commit()
        return int(existing.version)

    max_version = db.execute(select(func.max(LevelConfig.version))).scalar() or 0
    row = LevelConfig(
        name="default",
        version=int(max_version) + 1,
        config_hash=digest,
        config_json=json.dumps(payload, ensure_ascii=False, sort_keys=True),
        is_active=1,
        created_at=now_iso(),
    )
    db.add(row)
    db.commit()
    return int(row.version)


def active_config_version(db: Session) -> str | None:
    row = db.execute(select(LevelConfig).where(LevelConfig.is_active == 1)).scalar_one_or_none()
    return None if row is None else str(row.config_hash)
