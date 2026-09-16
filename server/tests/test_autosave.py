"""GET/PUT /api/autosave：自动存档往返、精度、契约 strictness、按用户隔离。"""

from __future__ import annotations

from sqlalchemy import func, select

from app.db import get_session_factory
from app.models import AutoSave
from helpers import make_save_payload


def test_autosave_requires_login(client, clean_tables):
    assert client.get("/api/autosave").status_code == 401
    response = client.put("/api/autosave", json=make_save_payload())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_missing_autosave_returns_404(auth_client):
    response = auth_client.get("/api/autosave")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "AUTOSAVE_NOT_FOUND"


def test_put_then_get_is_field_identical(auth_client):
    """AC-4a（自动存档版）：读档后与存档时完全一致（逐字段比对，含开火相位）。"""
    payload = make_save_payload()
    put = auth_client.put("/api/autosave", json=payload)
    assert put.status_code == 200
    assert put.json()["ok"] is True
    assert isinstance(put.json()["updatedAt"], str) and put.json()["updatedAt"]

    got = auth_client.get("/api/autosave")
    assert got.status_code == 200
    body = got.json()
    assert body["totalLevels"] == 10
    for key, value in payload.items():
        assert body["payload"][key] == value, (
            f"字段 {key} 往返不一致：{body['payload'][key]!r} != {value!r}"
        )


def test_fractional_ms_is_preserved(auth_client):
    """毫秒为 1/60s 的整数倍：小数毫秒必须原样往返、不被截断。"""
    auth_client.put("/api/autosave", json=make_save_payload(elapsedMs=12345.5))
    body = auth_client.get("/api/autosave").json()["payload"]
    assert body["elapsedMs"] == 12345.5
    assert body["towers"][1]["cooldownMs"] == 812.5


def test_put_overwrites_single_row_per_user(auth_client):
    auth_client.put("/api/autosave", json=make_save_payload(gold=100, lives=20))
    auth_client.put("/api/autosave", json=make_save_payload(gold=42, lives=7, currentWave=9))

    body = auth_client.get("/api/autosave").json()["payload"]
    assert body["gold"] == 42
    assert body["lives"] == 7
    assert body["currentWave"] == 9

    factory = get_session_factory()
    with factory() as session:
        count = session.execute(select(func.count()).select_from(AutoSave)).scalar()
    assert count == 1


def test_put_invalid_body_returns_422(auth_client):
    payload = make_save_payload()
    payload["waveState"] = "NOT_A_STATE"
    response = auth_client.put("/api/autosave", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_put_rejects_unknown_field(auth_client):
    """契约 strictness：多出的字段必须被拒绝，避免静默漂移。"""
    payload = make_save_payload()
    payload["unexpectedField"] = 1
    assert auth_client.put("/api/autosave", json=payload).status_code == 422


def test_put_missing_required_field_returns_422(auth_client):
    payload = make_save_payload()
    payload.pop("gold")
    assert auth_client.put("/api/autosave", json=payload).status_code == 422


def test_tower_cooldown_ms_is_part_of_the_contract(auth_client):
    """★ 跨栈契约回归：内核 Memento 会携带 towers[].cooldownMs（开火相位）。

    该字段曾经只存在于 TS 侧导致 PUT 直接 422；这里把两侧对齐钉死在测试里。
    """
    payload = make_save_payload()
    assert auth_client.put("/api/autosave", json=payload).status_code == 200

    body = auth_client.get("/api/autosave").json()["payload"]
    assert [t["cooldownMs"] for t in body["towers"]] == [0.0, 812.5]
    assert body["towers"] == payload["towers"]


def test_tower_without_cooldown_ms_is_rejected(auth_client):
    """反向守护：少了 cooldownMs 也必须 422，否则 TS 侧严格 schema 读档会失败。"""
    payload = make_save_payload()
    payload["towers"] = [{"col": 3, "row": 9, "towerId": "arrow", "level": 2, "targeting": "FIRST"}]
    response = auth_client.put("/api/autosave", json=payload)
    assert response.status_code == 422
    assert "cooldownMs" in response.json()["error"]["message"]


def test_autosave_is_isolated_per_user(client, clean_tables):
    """多用户隔离：各自的自动存档互不可见、互不覆盖。"""
    client.post("/api/auth/register", json={"username": "user-a", "password": "secret-123"})
    client.put("/api/autosave", json=make_save_payload(gold=11, level=3))
    assert client.get("/api/autosave").json()["payload"]["gold"] == 11

    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={"username": "user-b", "password": "secret-123"})
    assert client.get("/api/autosave").status_code == 404  # B 看不到 A 的存档
    client.put("/api/autosave", json=make_save_payload(gold=22, level=5))

    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "user-a", "password": "secret-123"})
    body = client.get("/api/autosave").json()["payload"]
    assert body["gold"] == 11
    assert body["level"] == 3  # A 的存档保持原样，未被 B 覆盖
