"""GET /api/config?level=N —— 前后端唯一数值真源（AC-3）。

按 (mtime, size) 缓存热读 level.json：改文件 → 下次请求即返回新值，
无需重启后端、无需重新构建前端。level 缺省为 1；合成时携带 campaign 元信息。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from ..config_loader import load_config
from ..schemas import ConfigResponse

router = APIRouter(tags=["config"])

LevelParam = Annotated[int, Query(ge=1, description="关卡编号（从 1 开始）")]


@router.get("/config", response_model=ConfigResponse)
def get_config(level: LevelParam = 1) -> ConfigResponse:
    return ConfigResponse.model_validate(load_config(level))
