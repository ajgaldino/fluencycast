import pytest


def get_auth_headers(client, email="phrase_user@fluencycast.com"):
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Password123!", "full_name": "Phrase Tester"}
    )
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123!"}
    )
    token = login_res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_manual_phrase_without_video(client):
    headers = get_auth_headers(client, email="manual_phrase@fluencycast.com")
    
    payload = {
        "text": "Consistency is the key to mastering English.",
        "translation": "Consistência é a chave para dominar o inglês.",
        "context_sentence": "Study 15 minutes everyday.",
        "phrase_type": "SENTENCE",
        "difficulty": "NORMAL"
    }
    
    res = client.post("/api/v1/phrases/", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["text"] == payload["text"]
    assert data["translation"] == payload["translation"]
    assert data["video_id"] is None
    assert data["phrase_type"] == "SENTENCE"
    assert data["status"] == "NEW"


def test_create_manual_word_without_video(client):
    headers = get_auth_headers(client, email="manual_word@fluencycast.com")
    
    payload = {
        "text": "relentless",
        "translation": "implacável, incansável",
        "context_sentence": "She has a relentless pursuit of excellence.",
        "phrase_type": "WORD",
        "difficulty": "HARD"
    }
    
    res = client.post("/api/v1/phrases/", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["text"] == "relentless"
    assert data["translation"] == "implacável, incansável"
    assert data["video_id"] is None
    assert data["phrase_type"] == "WORD"
    assert data["difficulty"] == "HARD"


def test_create_manual_word_deduplication(client):
    headers = get_auth_headers(client, email="dedup_word@fluencycast.com")
    
    payload1 = {
        "text": "breakthrough",
        "translation": "",
        "phrase_type": "WORD"
    }
    res1 = client.post("/api/v1/phrases/", json=payload1, headers=headers)
    assert res1.status_code == 201
    id1 = res1.json()["id"]

    # Post same word with translation
    payload2 = {
        "text": "BREAKTHROUGH",
        "translation": "avanço significativo",
        "phrase_type": "WORD"
    }
    res2 = client.post("/api/v1/phrases/", json=payload2, headers=headers)
    assert res2.status_code == 201
    data2 = res2.json()
    assert data2["id"] == id1
    assert data2["translation"] == "avanço significativo"


def test_create_phrase_empty_text_error(client):
    headers = get_auth_headers(client, email="empty_err@fluencycast.com")
    
    res = client.post("/api/v1/phrases/", json={"text": "   "}, headers=headers)
    assert res.status_code == 400
    assert "não pode ser vazio" in res.json()["detail"]
