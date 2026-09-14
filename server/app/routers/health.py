"""GET /api/health —— 就绪探针。"""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut(status="ok")
