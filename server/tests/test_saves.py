"""GET/PUT /api/save/{slot}：404、参数校验、覆盖、往返完全一致。"""

from __future__ import annotations

from sqlalchemy import func, select

from app.db import get_session_factory
from app.models import SaveState


def make_payload(**overrides) -> dict:
    """一份字段齐全、含小数与非整数毫秒的存档快照（用于验证往返精度）。"""
    payload: dict = {
        "level": 3,
        "configVersion": "0123456789abcdef",
        "savedAt": "2026-09-14T00:00:00+00:00",
        "elapsedMs": 12345.5,
        "gold": 137,
        "lives": 18,
        "currentWave": 4,
        "waveState": "ACTIVE",
        "speedMultiplier": 2,
        "paused": False,
        "prepRemainingMs": 0.0,
        "towers": [
            {"col": 3, "row": 9, "towerId": "arrow", "level": 2, "targeting": "FIRST", "cooldownMs": 0.0},
            {"col": 4, "row": 9, "towerId": "frost", "level": 1, "targeting": "CLOSEST", "cooldownMs": 812.5},
        ],
        "spawnProgress": {
            "waveIndex": 3,
            "groups": [{"enemy": "normal", "spawnedCount": 5, "timeSinceLastMs": 233.33333333333334}],
        },
        "enemies": [
            {
                "id": 11,
                "enemyId": "normal",
                "pathDistance": 418.25,
                "hp": 63.5,
                "maxHp": 110.00000000000001,
                "spawnOrder": 11,
                "slowDebuffs": [{"sourceTowerId": 133, "slowFactor": 0.3, "remainingMs": 1500.0}],
            }
        ],
        "projectiles": [
            {
                "id": 7,
                "sourceTowerId": 133,
                "x": 130.5,
                "y": 380.0,
                "targetEnemyId": 11,
                "hitX": None,
                "hitY": None,
                "speed": 600,
                "damage": 25,
                "splashRadius": None,
                "slowFactor": None,
                "slowDuration": None,
            }
        ],
        "nextEnemyId": 12,
        "nextProjectileId": 8,
    }
    payload.update(overrides)
    return payload


def test_get_missing_slot_returns_404(client, clean_tables):
    response = client.get("/api/save/1")
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "SAVE_NOT_FOUND"
    assert "1" in body["error"]["message"]


def test_slot_must_be_positive(client, clean_tables):
    for path in ("/api/save/0", "/api/save/-3"):
        response = client.get(path)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_put_then_get_is_field_identical(client, clean_tables):
    """AC-4a：读档后与存档时完全一致（逐字段比对）。"""
    payload = make_payload()
    put = client.put("/api/save/1", json=payload)
    assert put.status_code == 200
    assert put.json()["ok"] is True
    assert put.json()["slot"] == 1

    got = client.get("/api/save/1")
    assert got.status_code == 200
    body = got.json()
    assert body["slot"] == 1
    for key, value in payload.items():
        assert body[key] == value, f"字段 {key} 往返不一致：{body[key]!r} != {value!r}"


def test_put_overwrites_single_row(client, clean_tables):
    client.put("/api/save/1", json=make_payload(gold=100, lives=20))
    client.put("/api/save/1", json=make_payload(gold=42, lives=7, currentWave=9))

    body = client.get("/api/save/1").json()
    assert body["gold"] == 42
    assert body["lives"] == 7
    assert body["currentWave"] == 9

    factory = get_session_factory()
    with factory() as session:
        count = session.execute(select(func.count()).select_from(SaveState)).scalar()
    assert count == 1


def test_slots_are_independent(client, clean_tables):
    client.put("/api/save/1", json=make_payload(gold=11))
    client.put("/api/save/2", json=make_payload(gold=22))
    assert client.get("/api/save/1").json()["gold"] == 11
    assert client.get("/api/save/2").json()["gold"] == 22


def test_put_invalid_body_returns_422(client, clean_tables):
    payload = make_payload()
    payload["waveState"] = "NOT_A_STATE"
    response = client.put("/api/save/1", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_put_rejects_unknown_field(client, clean_tables):
    """契约 strictness：多出的字段必须被拒绝，避免静默漂移。"""
    payload = make_payload()
    payload["unexpectedField"] = 1
    response = client.put("/api/save/1", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_put_missing_required_field_returns_422(client, clean_tables):
    payload = make_payload()
    payload.pop("gold")
    response = client.put("/api/save/1", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_tower_cooldown_ms_is_part_of_the_contract(client, clean_tables):
    """★ 跨栈契约回归：内核 Memento 会携带 towers[].cooldownMs（开火相位）。

    该字段曾经只存在于 TS 侧，导致 PUT /api/save/{slot} 因 extra="forbid" 直接 422，
    AC-4「存档可续玩」在真实链路上是坏的（pytest 与 vitest 各自单测都发现不了）。
    这里把两侧的对齐钉死在测试里：towers[].cooldownMs 必填且往返保真。
    """
    payload = make_payload()
    assert client.put("/api/save/1", json=payload).status_code == 200

    body = client.get("/api/save/1").json()
    assert [t["cooldownMs"] for t in body["towers"]] == [0.0, 812.5]
    assert body["towers"] == payload["towers"]


def test_tower_without_cooldown_ms_is_rejected(client, clean_tables):
    """反向守护：少了 cooldownMs 也必须 422，否则 TS 侧严格 schema 读档会失败。"""
    payload = make_payload()
    payload["towers"] = [{"col": 3, "row": 9, "towerId": "arrow", "level": 2, "targeting": "FIRST"}]
    response = client.put("/api/save/1", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "cooldownMs" in response.json()["error"]["message"]


def test_save_level_roundtrip_and_legacy_default(client, clean_tables):
    """存档往返保留关卡号；旧档缺 level 字段时服务端默认补为第 1 关。"""
    payload = dict(make_payload())
    payload["level"] = 6
    assert client.put("/api/save/101", json=payload).status_code == 200
    assert client.get("/api/save/101").json()["level"] == 6

    legacy = dict(make_payload())
    legacy.pop("level")
    assert client.put("/api/save/102", json=legacy).status_code == 200
    assert client.get("/api/save/102").json()["level"] == 1
