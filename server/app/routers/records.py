"""POST/GET /api/records —— 战绩登记与查询（AC-4b）。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Record
from ..schemas import RecordCreate, RecordListOut, RecordOut
from ..seed import now_iso

router = APIRouter(prefix="/records", tags=["records"])

LimitParam = Annotated[int, Query(ge=1, le=200, description="返回条数上限（1..200）")]


def _to_out(row: Record) -> RecordOut:
    return RecordOut(
        id=int(row.id),
        result=row.result,  # type: ignore[arg-type]
        waveReached=int(row.wave_reached),
        livesRemaining=int(row.lives_remaining),
        elapsedMs=float(row.elapsed_ms),
        configVersion=row.config_version,
        createdAt=row.created_at,
    )


@router.post("", status_code=201, response_model=RecordOut)
def create_record(payload: RecordCreate, db: Annotated[Session, Depends(get_db)]) -> RecordOut:
    row = Record(
        result=payload.result,
        wave_reached=int(payload.waveReached),
        lives_remaining=int(payload.livesRemaining),
        # 保留毫秒精度（REAL 列）：与 save 端同物理量保持一致，读回不被截断。
        elapsed_ms=float(payload.elapsedMs),
        config_version=payload.configVersion,
        created_at=now_iso(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.get("", response_model=RecordListOut)
def list_records(
    db: Annotated[Session, Depends(get_db)],
    limit: LimitParam = 50,
) -> RecordListOut:
    total = db.execute(select(func.count()).select_from(Record)).scalar() or 0
    rows = (
        db.execute(
            select(Record)
            .order_by(Record.created_at.desc(), Record.id.desc())
            .limit(int(limit))
        )
        .scalars()
        .all()
    )
    return RecordListOut(total=int(total), items=[_to_out(row) for row in rows])
