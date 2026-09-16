"""配置热读：以 level.json 为唯一数值真源，按 (mtime, size) 缓存，文件一改下次请求即生效（AC-3a）。

- v2 结构：全区共享（grid/canvas/rules/towers/enemies）+ 关卡列表（levels[]，每关含地图/经济/波次）。
- ``GET /api/config?level=N`` → 合成第 N 关的单关配置（v1 形状 + campaign 元信息，前端契约不变）。
- 路径可被环境变量 ``TD_CONFIG_PATH`` 覆盖（测试用临时文件）。
- 内容 hash（sha256 截断 16 位）作为版本号，暴露为响应中的 ``version``。
- 解析后先过 Pydantic 校验（extra=forbid），契约漂移立即报 CONFIG_INVALID 而不是静默败坏。
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path

from pydantic import ValidationError

from .schemas import ApiError, CampaignConfig, ConfigResponse

_SERVER_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = _SERVER_DIR / "config" / "level.json"

_lock = threading.Lock()
# path -> (mtime_ns, size, config_hash, payload[不含 version])
_cache: dict[str, tuple[int, int, str, dict]] = {}


def config_path() -> Path:
    override = os.environ.get("TD_CONFIG_PATH")
    return Path(override) if override else DEFAULT_CONFIG_PATH


def canonical_hash(raw: dict) -> str:
    """对配置内容取稳定 hash（键排序、紧凑分隔符），与文件格式/空白无关。"""
    blob = json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def clear_cache() -> None:
    """仅供测试使用。"""
    with _lock:
        _cache.clear()


def _read_raw(path: Path) -> tuple[int, int, dict]:
    stat = path.stat()
    text = path.read_text(encoding="utf-8")
    return stat.st_mtime_ns, len(text), json.loads(text)


def load_raw() -> dict:
    """读取并校验 level.json（v2 多关卡文档），返回 {**doc, version}（不含 version 的原文 + 内容 hash）。"""
    path = config_path()
    try:
        mtime_ns, size, raw = _read_raw(path)
    except FileNotFoundError as exc:
        raise ApiError(500, "CONFIG_INVALID", f"配置文件不存在：{path}") from exc
    except OSError as exc:
        raise ApiError(500, "CONFIG_INVALID", f"配置文件不可读：{exc}") from exc
    except json.JSONDecodeError as exc:
        raise ApiError(500, "CONFIG_INVALID", f"配置不是合法 JSON：{exc}") from exc

    key = str(path)
    with _lock:
        cached = _cache.get(key)
        if cached is not None and cached[0] == mtime_ns and cached[1] == size:
            return {**cached[3], "version": cached[2]}

    try:
        campaign = CampaignConfig.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(part) for part in first.get("loc", ())) or "<root>"
        raise ApiError(
            500,
            "CONFIG_INVALID",
            f"配置未通过校验（{exc.error_count()} 处），首个问题：{loc} {first.get('msg', '')}",
        ) from exc

    digest = canonical_hash(raw)
    payload = campaign.model_dump()
    with _lock:
        _cache[key] = (mtime_ns, size, digest, payload)
    return {**payload, "version": digest}


def compose_level(raw: dict, level: int) -> dict:
    """把 v2 文档合成为第 level 关的单关配置（ConfigResponse 形状）。"""
    levels = raw["levels"]
    entry = None
    for item in levels:
        if int(item["id"]) == level:
            entry = item
            break
    if entry is None:
        raise ApiError(404, "LEVEL_NOT_FOUND", f"关卡 {level} 不存在（共 {len(levels)} 关）")

    payload = {
        "version": str(raw["version"]),
        "campaign": {"level": int(entry["id"]), "name": entry["name"], "totalLevels": len(levels)},
        "grid": raw["grid"],
        "canvas": raw["canvas"],
        "map": entry["map"],
        "economy": entry["economy"],
        "rules": raw["rules"],
        "towers": raw["towers"],
        "enemies": raw["enemies"],
        "waves": entry["waves"],
    }
    try:
        ConfigResponse.model_validate(payload)
    except ValidationError as exc:  # pragma: no cover - 兜底
        raise ApiError(500, "CONFIG_INVALID", f"关卡合成响应形状非法：{exc}") from exc
    return payload


def load_config(level: int = 1) -> dict:
    """返回第 level 关的 ConfigResponse 形状 dict（含 version）。"""
    return compose_level(load_raw(), level)


def current_config_version() -> str:
    return str(load_raw()["version"])
