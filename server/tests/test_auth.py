"""POST /api/auth/*：注册 / 登录 / 登出 / 会话查询 + 需要登录的守卫。"""

from __future__ import annotations

from helpers import make_record, make_save_payload


def test_register_auto_login_and_logout(client, clean_tables):
    response = client.post("/api/auth/register", json={"username": "viking", "password": "hunter-42"})
    assert response.status_code == 201
    user = response.json()
    assert user["username"] == "viking"
    assert isinstance(user["id"], int)
    assert isinstance(user["createdAt"], str) and user["createdAt"]

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "viking"

    assert client.post("/api/auth/logout").json() == {"ok": True}
    assert client.get("/api/auth/me").status_code == 401


def test_login_with_correct_credentials(client, clean_tables):
    client.post("/api/auth/register", json={"username": "alice", "password": "secret-123"})
    client.post("/api/auth/logout")

    response = client.post("/api/auth/login", json={"username": "alice", "password": "secret-123"})
    assert response.status_code == 200
    assert client.get("/api/auth/me").json()["username"] == "alice"


def test_login_wrong_password_or_unknown_user(client, clean_tables):
    client.post("/api/auth/register", json={"username": "bob", "password": "secret-123"})
    client.post("/api/auth/logout")

    for body in (
        {"username": "bob", "password": "wrong-pass"},
        {"username": "nobody", "password": "secret-123"},
    ):
        response = client.post("/api/auth/login", json=body)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_register_validation(client, clean_tables):
    # 密码过短 / 用户名含非法字符 → 422
    assert client.post("/api/auth/register", json={"username": "okname", "password": "123"}).status_code == 422
    assert (
        client.post("/api/auth/register", json={"username": "bad name!", "password": "secret-123"}).status_code
        == 422
    )


def test_register_duplicate_username_case_insensitive(client, clean_tables):
    client.post("/api/auth/register", json={"username": "Unique", "password": "secret-123"})
    client.post("/api/auth/logout")
    response = client.post("/api/auth/register", json={"username": "unique", "password": "secret-123"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "USERNAME_TAKEN"


def test_protected_endpoints_require_login(client, clean_tables):
    assert client.get("/api/autosave").status_code == 401
    assert client.put("/api/autosave", json=make_save_payload()).status_code == 401
    assert client.get("/api/records").status_code == 401
    assert client.post("/api/records", json=make_record()).status_code == 401
    # 公开端点不受影响
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/config").status_code == 200
