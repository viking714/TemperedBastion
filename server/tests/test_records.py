"""POST/GET /api/records：登记、排序、limit 约束、错误信封。"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.db import get_session_factory
from app.models import Record


def make_record(**overrides) -> dict:
    body = {
        "result": "victory",
        "waveReached": 10,
        "livesRemaining": 12,
        "elapsedMs": 245000,
        "configVersion": "0123456789abcdef",
    }
    body.update(overrides)
    return body


def test_post_creates_record(client, clean_tables):
    response = client.post("/api/records", json=make_record())
    assert response.status_code == 201
    body = response.json()
    assert body["result"] == "victory"
    assert body["waveReached"] == 10
    assert body["livesRemaining"] == 12
    assert body["elapsedMs"] == 245000
    assert body["configVersion"] == "0123456789abcdef"
    assert isinstance(body["id"], int)
    assert isinstance(body["createdAt"], str) and body["createdAt"]


def test_fractional_elapsed_is_preserved_as_real(client, clean_tables):
    """用时列改为 REAL（一致性与 save_state 端对齐）；小数毫秒必须原样保留、不被截断。"""
    response = client.post("/api/records", json=make_record(elapsedMs=245000.6))
    assert response.status_code == 201
    assert response.json()["elapsedMs"] == pytest.approx(245000.6)

    # 列表读回同样不截断
    body = client.get("/api/records").json()
    assert body["total"] == 1
    assert body["items"][0]["elapsedMs"] == pytest.approx(245000.6)


def test_integer_elapsed_stays_integral(client, clean_tables):
    """整数值毫秒经 REAL 列往返后仍是同一个整数（无 245000.00000001 之类的漂移）。"""
    response = client.post("/api/records", json=make_record(elapsedMs=245000))
    assert response.status_code == 201
    assert response.json()["elapsedMs"] == 245000


def test_post_invalid_result_returns_422(client, clean_tables):
    response = client.post("/api/records", json=make_record(result="draw"))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_negative_lives_returns_422(client, clean_tables):
    response = client.post("/api/records", json=make_record(livesRemaining=-1))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_list_empty(client, clean_tables):
    response = client.get("/api/records")
    assert response.status_code == 200
    assert response.json() == {"total": 0, "items": []}


def test_list_returns_newest_first(client, clean_tables):
    for index in range(3):
        client.post("/api/records", json=make_record(waveReached=index + 1))

    body = client.get("/api/records").json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    waves = [item["waveReached"] for item in body["items"]]
    assert waves == [3, 2, 1]
    ids = [item["id"] for item in body["items"]]
    assert ids == sorted(ids, reverse=True)


def test_list_limit_applies(client, clean_tables):
    for index in range(5):
        client.post("/api/records", json=make_record(waveReached=index + 1))

    body = client.get("/api/records", params={"limit": 2}).json()
    assert body["total"] == 5  # total 为全量条数，不受 limit 影响
    assert len(body["items"]) == 2
    assert [item["waveReached"] for item in body["items"]] == [5, 4]


def test_list_limit_out_of_range_returns_422(client, clean_tables):
    for limit in (0, 201):
        response = client.get("/api/records", params={"limit": limit})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_records_persist_in_db(client, clean_tables):
    client.post("/api/records", json=make_record(result="defeat", waveReached=4, livesRemaining=0))
    factory = get_session_factory()
    with factory() as session:
        row = session.execute(select(Record)).scalar_one()
    assert row.result == "defeat"
    assert row.wave_reached == 4
    assert row.lives_remaining == 0

    with factory() as session:
        count = session.execute(select(func.count()).select_from(Record)).scalar()
    assert count == 1


def test_record_level_roundtrip_and_legacy_default(client, clean_tables):
    """多关卡：level 可登记、可读回；旧客户端不传 level 时默认第 1 关（向后兼容）。"""
    created = client.post("/api/records", json=make_record(level=7)).json()
    assert created["level"] == 7
    legacy = client.post("/api/records", json=make_record()).json()
    assert legacy["level"] == 1

    listed = client.get("/api/records").json()
    by_id = {item["id"]: item["level"] for item in listed["items"]}
    assert by_id[created["id"]] == 7
    assert by_id[legacy["id"]] == 1
