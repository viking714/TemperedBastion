"""GET /api/config —— 前后端唯一数值真源（AC-3）。

按 (mtime, size) 缓存热读 level.json：改文件 → 下次请求即返回新值，
无需重启后端、无需重新构建前端。
"""

from __future__ import annotations

from fastapi import APIRouter

from ..config_loader import load_config
from ..schemas import ConfigResponse

router = APIRouter(tags=["config"])


@router.get("/config", response_model=ConfigResponse)
def get_config() -> ConfigResponse:
    return ConfigResponse.model_validate(load_config())
