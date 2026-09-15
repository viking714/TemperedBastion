"""GET/PUT /api/save/{slot} —— 存档槽读写的唯一入口（AC-4a）。

存档槽每槽一行、可覆盖；state_json 保存前端内核的全量快照，
读档时原样返回以保证「读档后与存档时完全一致」。
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import SaveState
from ..schemas import ApiError, SavePayload, SaveWriteResponse
from ..seed import now_iso

router = APIRouter(prefix="/save", tags=["saves"])

# 上界取 SQLite INTEGER 的最大值（2**63-1）：超出该范围的槽号存储层无法表示，
# 会从 sqlite3 抛出 OverflowError（未捕获 → 500）。在此拦成 422，
# 让所有非法槽位（≤0、超范围）都统一走 VALIDATION_ERROR 信封，而不是 500。
SlotParam = Annotated[int, Path(ge=1, le=2**63 - 1, description="存档槽号（正整数）")]


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

    # ★ 原子 upsert —— 用 SQLite 方言的 INSERT … ON CONFLICT(slot) DO UPDATE，
    #   把「判存在 + 插入 / 更新」收敛成**一条 SQL**，由引擎层原子完成。
    #
    #   为什么选原子 upsert，而不是「捕获 IntegrityError → rollback → 重查 → UPDATE」：
    #     1) 旧实现是 check-then-act（先 SELECT 判空再 INSERT）。并发同槽时两个请求都
    #        读到 None → 都 INSERT → 触发 save_state.slot 的 UNIQUE 约束 →
    #        IntegrityError 没人接 → FastAPI 500。
    #     2) 「先查后写」本身就是竞态窗口。事后补捕只是把窗口缩到「查与写之间」，仍可能
    #        两个连接真正抢写（SQLite 下还会退化成 database-is-locked 重试）。
    #     3) ON CONFLICT 由 SQLite 在单条语句内原子判定，不存在窗口；也不需要显式重试
    #        （无重试风暴）或长事务。语义上正好表达「每槽一行、可覆盖」的设计。
    insert_values = {
        "slot": slot,
        "config_version": str(body["configVersion"]),
        "gold": int(body["gold"]),
        "lives": int(body["lives"]),
        "current_wave": int(body["currentWave"]),
        "elapsed_ms": int(round(float(body["elapsedMs"]))),
        "state_json": state_json,
        # created_at 只在「首次插入」时写入；冲突更新时**不刷新**（保留首次建档时间）。
        "created_at": now,
        "updated_at": now,
    }
    stmt = sqlite_insert(SaveState).values(**insert_values)
    # 冲突时只 SET 可变列 —— 显式排除 created_at，避免并发更新覆盖首次写入时间。
    stmt = stmt.on_conflict_do_update(
        index_elements=[SaveState.slot],
        set_={
            "config_version": stmt.excluded.config_version,
            "gold": stmt.excluded.gold,
            "lives": stmt.excluded.lives,
            "current_wave": stmt.excluded.current_wave,
            "elapsed_ms": stmt.excluded.elapsed_ms,
            "state_json": stmt.excluded.state_json,
            "updated_at": stmt.excluded.updated_at,
        },
    )
    db.execute(stmt)
    db.commit()
    return SaveWriteResponse(ok=True, slot=slot, updatedAt=now)
