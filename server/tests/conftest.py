"""pytest 公共夹具。

关键点：必须在 import app.* 之前把 TD_DB_PATH 指到临时文件，
因为 db 模块在首次使用时读取该环境变量。
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="td-server-tests-"))
os.environ["TD_DB_PATH"] = str(_TMP_ROOT / "test.db")
os.environ.setdefault("TD_CONFIG_PATH", str(SERVER_DIR / "config" / "level.json"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402

from app import config_loader  # noqa: E402
from app.db import get_session_factory, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AutoSave, AuthSession, LevelConfig, Record, SaveState, User  # noqa: E402


@pytest.fixture(scope="session")
def client():
    """带 lifespan 的 TestClient：触发建表 + 配置版本审计。"""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def clean_tables():
    """清空全部业务表（含审计表与账号），保证用例间互不干扰。"""
    init_db()
    factory = get_session_factory()
    with factory() as session:
        for model in (Record, SaveState, LevelConfig, User, AuthSession, AutoSave):
            session.execute(delete(model))
        session.commit()
    return True


@pytest.fixture()
def auth_client(client, clean_tables):
    """已注册并自动登录的客户端（注册即登录；每个用例独立账号状态）。"""
    response = client.post(
        "/api/auth/register", json={"username": "tester", "password": "secret-123"}
    )
    assert response.status_code == 201
    return client


@pytest.fixture()
def temp_config(tmp_path, monkeypatch):
    """把 level.json 复制到临时目录并切换 TD_CONFIG_PATH（用于热读/畸形配置用例）。"""
    source = SERVER_DIR / "config" / "level.json"
    target = tmp_path / "level.json"
    shutil.copyfile(source, target)
    monkeypatch.setenv("TD_CONFIG_PATH", str(target))
    config_loader.clear_cache()
    try:
        yield target
    finally:
        config_loader.clear_cache()


@pytest.fixture(scope="session", autouse=True)
def _cleanup_tmp_root():
    yield
    shutil.rmtree(_TMP_ROOT, ignore_errors=True)
