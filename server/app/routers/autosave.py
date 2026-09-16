"""GET/PUT /api/autosave —— 每用户一行的自动存档（取代旧的手动多槽存档）。

- 需登录（require_user）；存档按 user_id 隔离。
- PUT 为原子 upsert（单条 SQL，无 check-then-act 竞态），随玩随存为常态。
- GET 返回 {payload, totalLevels}：客户端据此决定续关位置（胜利后续下一关等）。
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..auth import require_user
from ..config_loader import load_raw
from ..db import get_db
from ..models import AutoSave, User
from ..schemas import ApiError, AutoSaveOut, AutoSaveWriteResponse, SavePayload
from ..seed import now_iso

router = APIRouter(prefix="/autosave", tags=["autosave"])


def _total_levels() -> int:
    return len(load_raw()["levels"])


@router.get("", response_model=AutoSaveOut)
def read_autosave(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_user)],
) -> AutoSaveOut:
    row = db.get(AutoSave, user.id)
    if row is None:
        raise ApiError(404, "AUTOSAVE_NOT_FOUND", "暂无自动存档")
    data = json.loads(row.state_json)
    return AutoSaveOut(payload=SavePayload.model_validate(data), totalLevels=_total_levels())


@router.put("", response_model=AutoSaveWriteResponse)
def write_autosave(
    payload: SavePayload,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_user)],
) -> AutoSaveWriteResponse:
    now = now_iso()
    body = payload.model_dump()
    state_json = json.dumps(body, ensure_ascii=False)

    stmt = sqlite_insert(AutoSave).values(
        user_id=user.id,
        level=int(payload.level),
        config_version=payload.configVersion,
        state_json=state_json,
        updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[AutoSave.user_id],
        set_={
            "level": stmt.excluded.level,
            "config_version": stmt.excluded.config_version,
            "state_json": stmt.excluded.state_json,
            "updated_at": stmt.excluded.updated_at,
        },
    )
    db.execute(stmt)
    db.commit()
    return AutoSaveWriteResponse(ok=True, updatedAt=now)
