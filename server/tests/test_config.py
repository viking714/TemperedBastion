"""GET /api/config 契约 + 热读生效 + 非法配置错误信封。"""

from __future__ import annotations

import json
import os
import time

from app.config_loader import current_config_version, load_config

REQUIRED_TOP_LEVEL = {
    "version",
    "campaign",
    "grid",
    "canvas",
    "map",
    "economy",
    "rules",
    "towers",
    "enemies",
    "waves",
}


def test_config_contract_shape(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    body = response.json()

    assert set(body.keys()) == REQUIRED_TOP_LEVEL

    campaign = body["campaign"]
    assert campaign["level"] == 1
    assert isinstance(campaign["name"], str) and campaign["name"]
    assert campaign["totalLevels"] == 10

    assert body["grid"] == {"cols": 20, "rows": 12, "tileSizePx": 40}
    assert body["canvas"]["logicWidthPx"] > 0 and body["canvas"]["logicHeightPx"] > 0
    assert len(body["map"]["pathWaypoints"]) >= 2
    assert len(body["map"]["pathWaypoints"][0]) == 2

    assert body["economy"]["initialLives"] >= 1
    assert 0 <= body["economy"]["sellRefundRatio"] <= 1

    rules = body["rules"]
    assert rules["maxTowerLevel"] >= 1
    assert rules["defaultTargeting"] == "FIRST"
    assert rules["speedOptions"] == [1, 2]
    assert rules["pauseFreezesAll"] is True

    assert [tower["id"] for tower in body["towers"]] == ["arrow", "cannon", "frost"]
    assert [tower["role"] for tower in body["towers"]] == ["single_target", "splash", "slow"]
    for tower in body["towers"]:
        assert len(tower["levels"]) == 3
        for level in tower["levels"]:
            assert {"level", "damage", "range", "fireRate", "projectileSpeed"} <= set(level.keys())

    assert [enemy["id"] for enemy in body["enemies"]] == ["normal", "fast", "heavy"]
    for enemy in body["enemies"]:
        assert {"hp", "speed", "armor", "bounty", "leakDamage"} <= set(enemy.keys())

    assert len(body["waves"]) >= 1
    for index, wave in enumerate(body["waves"], start=1):
        assert wave["wave"] == index
        assert len(wave["groups"]) >= 1
        for group in wave["groups"]:
            assert group["count"] >= 1
            assert group["spawnIntervalSec"] > 0


def test_config_version_is_stable_content_hash(client):
    first = client.get("/api/config").json()
    second = client.get("/api/config").json()
    assert first["version"] == second["version"]
    assert len(first["version"]) == 16
    # 与加载器直接算出的内容 hash 一致（唯一数值真源 → 版本号可溯源）
    assert first["version"] == load_config()["version"]
    assert first["version"] == current_config_version()


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_config_level_parameter_composes_level(client):
    """?level=N 合成对应关卡；版本号仍随文件内容（不随关卡变化）。"""
    first = client.get("/api/config?level=1").json()
    third = client.get("/api/config?level=3").json()
    assert first["campaign"]["level"] == 1
    assert third["campaign"]["level"] == 3
    assert first["version"] == third["version"]
    assert first["map"]["pathWaypoints"] != third["map"]["pathWaypoints"]
    assert first["waves"] != third["waves"]


def test_config_level_out_of_range(client):
    response = client.get("/api/config?level=11")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "LEVEL_NOT_FOUND"
    assert client.get("/api/config?level=0").status_code == 422


def test_all_levels_shape_and_difficulty_ramp(client):
    """10 个关卡：地图轴对齐、端点与出生/基地一致、难度参数单调不减。"""
    from app.config_loader import load_raw

    raw = load_raw()
    levels = raw["levels"]
    assert len(levels) == 10
    assert [entry["id"] for entry in levels] == list(range(1, 11))
    names = [entry["name"] for entry in levels]
    assert len(set(names)) == len(names)

    last_gold = -1
    last_waves = -1
    last_hp = -1.0
    for entry in levels:
        points = entry["map"]["pathWaypoints"]
        assert len(points) >= 2
        assert tuple(points[0]) == tuple(entry["map"]["spawnTile"])
        assert tuple(points[-1]) == tuple(entry["map"]["baseTile"])
        for a, b in zip(points, points[1:]):
            assert a[0] == b[0] or a[1] == b[1], f"关卡 {entry['id']} 存在非轴对齐线段：{a}->{b}"
        assert len(entry["waves"]) >= 1
        assert [w["wave"] for w in entry["waves"]] == list(range(1, len(entry["waves"]) + 1))
        assert entry["economy"]["initialGold"] >= last_gold
        assert len(entry["waves"]) >= last_waves
        assert entry["economy"]["hpScalePerWave"] >= last_hp
        last_gold = entry["economy"]["initialGold"]
        last_waves = len(entry["waves"])
        last_hp = entry["economy"]["hpScalePerWave"]

    # 从第 1 关到第 10 关，血量成长严格上升（难度确实在增加）
    assert levels[-1]["economy"]["hpScalePerWave"] > levels[0]["economy"]["hpScalePerWave"]


def test_config_hot_reload_without_restart(client, temp_config):
    """AC-3a：改 level.json 后（不重启、不重建前端）下次请求即返回新值。"""
    before = client.get("/api/config").json()
    original_damage = before["towers"][0]["levels"][0]["damage"]

    raw = json.loads(temp_config.read_text(encoding="utf-8"))
    raw["towers"][0]["levels"][0]["damage"] = original_damage + 7
    temp_config.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    bumped = time.time_ns() + 5_000_000_000
    os.utime(temp_config, ns=(bumped, bumped))

    after = client.get("/api/config").json()
    assert after["towers"][0]["levels"][0]["damage"] == original_damage + 7
    assert after["version"] != before["version"]


def test_config_malformed_json_returns_error_envelope(client, temp_config):
    temp_config.write_text("{ this is not json", encoding="utf-8")
    bumped = time.time_ns() + 6_000_000_000
    os.utime(temp_config, ns=(bumped, bumped))

    response = client.get("/api/config")
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "CONFIG_INVALID"
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]


def test_config_schema_violation_returns_error_envelope(client, temp_config):
    raw = json.loads(temp_config.read_text(encoding="utf-8"))
    raw["rules"]["defaultTargeting"] = "NOT_A_MODE"
    temp_config.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    bumped = time.time_ns() + 7_000_000_000
    os.utime(temp_config, ns=(bumped, bumped))

    response = client.get("/api/config")
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "CONFIG_INVALID"
    assert "defaultTargeting" in body["error"]["message"]
