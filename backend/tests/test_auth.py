import pytest


def test_register_user(client):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@fluencycast.com",
            "password": "StrongPassword123!",
            "full_name": "Anderson Test"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "test@fluencycast.com"
    assert data["full_name"] == "Anderson Test"
    assert "id" in data
    assert data["profile"]["english_level"] == "B1"


def test_register_duplicate_email(client):
    payload = {
        "email": "duplicate@fluencycast.com",
        "password": "StrongPassword123!",
        "full_name": "Anderson Duplicate"
    }
    res1 = client.post("/api/v1/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/v1/auth/register", json=payload)
    assert res2.status_code == 400
    assert "already exists" in res2.json()["detail"]


def test_login_success(client):
    email = "login_test@fluencycast.com"
    password = "MySecurePassword123"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Login User"}
    )

    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password}
    )
    assert response.status_code == 200
    token_data = response.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"


def test_login_invalid_password(client):
    email = "wrong_pwd@fluencycast.com"
    password = "CorrectPassword123"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password}
    )

    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "WrongPassword456"}
    )
    assert response.status_code == 401


def test_get_me_authenticated(client):
    email = "me_test@fluencycast.com"
    password = "MyPassword123"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Me User"}
    )

    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password}
    )
    token = login_res.json()["access_token"]

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == email
    assert data["full_name"] == "Me User"


def test_get_me_unauthorized(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
