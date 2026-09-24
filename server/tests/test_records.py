"""POST/GET /api/records：登记、排序、limit 约束、错误信封、按用户隔离与遗留迁移。

多用户化后全部接口需登录：用例统一走 `auth_client`（注册即登录）。
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.db import get_session_factory
from app.models import Record
from helpers import make_record


def test_post_creates_record(auth_client):
    response = auth_client.post("/api/records", json=make_record())
    assert response.status_code == 201
    body = response.json()
    assert body["result"] == "victory"
    assert body["waveReached"] == 10
    assert body["livesRemaining"] == 12
    assert body["elapsedMs"] == 245000
    assert body["configVersion"] == "0123456789abcdef"
    assert isinstance(body["id"], int)
    assert isinstance(body["createdAt"], str) and body["createdAt"]


def test_fractional_elapsed_is_preserved_as_real(auth_client):
    """用时列为 REAL；小数毫秒必须原样保留、不被截断。"""
    response = auth_client.post("/api/records", json=make_record(elapsedMs=245000.6))
    assert response.status_code == 201
    assert response.json()["elapsedMs"] == pytest.approx(245000.6)

    body = auth_client.get("/api/records").json()
    assert body["total"] == 1
    assert body["items"][0]["elapsedMs"] == pytest.approx(245000.6)


def test_integer_elapsed_stays_integral(auth_client):
    """整数值毫秒经 REAL 列往返后仍是同一个整数（无浮点漂移）。"""
    response = auth_client.post("/api/records", json=make_record(elapsedMs=245000))
    assert response.status_code == 201
    assert response.json()["elapsedMs"] == 245000


def test_post_invalid_result_returns_422(auth_client):
    response = auth_client.post("/api/records", json=make_record(result="draw"))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_negative_lives_returns_422(auth_client):
    response = auth_client.post("/api/records", json=make_record(livesRemaining=-1))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_list_empty(auth_client):
    response = auth_client.get("/api/records")
    assert response.status_code == 200
    assert response.json() == {"total": 0, "items": []}


def test_list_returns_newest_first(auth_client):
    for index in range(3):
        auth_client.post("/api/records", json=make_record(waveReached=index + 1))

    body = auth_client.get("/api/records").json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    waves = [item["waveReached"] for item in body["items"]]
    assert waves == [3, 2, 1]
    ids = [item["id"] for item in body["items"]]
    assert ids == sorted(ids, reverse=True)


def test_list_limit_applies(auth_client):
    for index in range(5):
        auth_client.post("/api/records", json=make_record(waveReached=index + 1))

    body = auth_client.get("/api/records", params={"limit": 2}).json()
    assert body["total"] == 5  # total 为全量条数，不受 limit 影响
    assert len(body["items"]) == 2
    assert [item["waveReached"] for item in body["items"]] == [5, 4]


def test_list_limit_out_of_range_returns_422(auth_client):
    for limit in (0, 201):
        response = auth_client.get("/api/records", params={"limit": limit})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_records_persist_in_db(auth_client):
    auth_client.post("/api/records", json=make_record(result="defeat", waveReached=4, livesRemaining=0))
    factory = get_session_factory()
    with factory() as session:
        row = session.execute(select(Record)).scalar_one()
    assert row.result == "defeat"
    assert row.wave_reached == 4
    assert row.lives_remaining == 0
    assert row.user_id is not None  # 归属当前登录用户

    with factory() as session:
        count = session.execute(select(func.count()).select_from(Record)).scalar()
    assert count == 1


def test_record_level_roundtrip_and_legacy_default(auth_client):
    """多关卡：level 可登记、可读回；旧客户端不传 level 时默认第 1 关（向后兼容）。"""
    created = auth_client.post("/api/records", json=make_record(level=7)).json()
    assert created["level"] == 7
    legacy = auth_client.post("/api/records", json=make_record()).json()
    assert legacy["level"] == 1

    listed = auth_client.get("/api/records").json()
    by_id = {item["id"]: item["level"] for item in listed["items"]}
    assert by_id[created["id"]] == 7
    assert by_id[legacy["id"]] == 1


def test_records_are_isolated_per_user(client, clean_tables):
    """多用户隔离：A 的战绩对 B 不可见，记账互不影响。"""
    client.post("/api/auth/register", json={"username": "user-a", "password": "secret-123"})
    client.post("/api/records", json=make_record(waveReached=3))
    assert client.get("/api/records").json()["total"] == 1

    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={"username": "user-b", "password": "secret-123"})
    assert client.get("/api/records").json()["total"] == 0
    client.post("/api/records", json=make_record(waveReached=9))
    assert client.get("/api/records").json()["total"] == 1

    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "user-a", "password": "secret-123"})
    body = client.get("/api/records").json()
    assert body["total"] == 1
    assert body["items"][0]["waveReached"] == 3


def test_first_user_inherits_legacy_records(client, clean_tables):
    """多用户化迁移：首位注册用户继承 v1 时代遗留的匿名战绩（user_id IS NULL）。"""
    factory = get_session_factory()
    with factory() as session:
        session.add(
            Record(
                result="victory",
                level=1,
                user_id=None,
                wave_reached=5,
                lives_remaining=17,
                elapsed_ms=1000.0,
                config_version="legacy-version",
                created_at="2026-09-01T00:00:00+00:00",
            )
        )
        session.commit()

    client.post("/api/auth/register", json={"username": "owner", "password": "secret-123"})
    body = client.get("/api/records").json()
    assert body["total"] == 1
    assert body["items"][0]["configVersion"] == "legacy-version"

    # 第二位用户不继承任何遗留数据
    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={"username": "newbie", "password": "secret-123"})
    assert client.get("/api/records").json()["total"] == 0
