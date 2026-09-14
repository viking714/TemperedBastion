"""GET/PUT /api/save/{slot} —— 存档槽读写的唯一入口（AC-4a）。

存档槽每槽一行、可覆盖；state_json 保存前端内核的全量快照，
读档时原样返回以保证「读档后与存档时完全一致」。
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import SaveState
from ..schemas import ApiError, SavePayload, SaveWriteResponse
from ..seed import now_iso

router = APIRouter(prefix="/save", tags=["saves"])

SlotParam = Annotated[int, Path(ge=1, description="存档槽号（正整数）")]


@router.get("/{slot}", response_model=SavePayload)
def read_save(slot: SlotParam, db: Annotated[Session, Depends(get_db)]) -> SavePayload:
    row = db.execute(select(SaveState).where(SaveState.slot == slot)).scalar_one_or_none()
    if row is None:
        raise ApiError(404, "SAVE_NOT_FOUND", f"存档槽 {slot} 暂无存档")
    data = json.loads(row.state_json)
    data["slot"] = slot
    return SavePayload.model_validate(data)


@router.put("/{slot}", response_model=SaveWriteResponse)
def write_save(
    slot: SlotParam,
    payload: SavePayload,
    db: Annotated[Session, Depends(get_db)],
) -> SaveWriteResponse:
    now = now_iso()
    body = payload.model_dump()
    body["slot"] = slot
    # JSON 序列化时保留完整精度，保证读档往返深度相等。
    state_json = json.dumps(body, ensure_ascii=False)

    row = db.execute(select(SaveState).where(SaveState.slot == slot)).scalar_one_or_none()
    if row is None:
        row = SaveState(slot=slot, created_at=now)
        db.add(row)

    row.config_version = str(body["configVersion"])
    row.gold = int(body["gold"])
    row.lives = int(body["lives"])
    row.current_wave = int(body["currentWave"])
    row.elapsed_ms = int(round(float(body["elapsedMs"])))
    row.state_json = state_json
    row.updated_at = now

    db.commit()
    return SaveWriteResponse(ok=True, slot=slot, updatedAt=now)
