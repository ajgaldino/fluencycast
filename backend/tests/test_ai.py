import pytest


def test_ai_tts_endpoint_returns_audio(client):
    response = client.get("/api/v1/ai/tts?text=Welcome+to+FluencyCast&voice=male")
    assert response.status_code == 200
    assert response.headers.get("content-type") == "audio/mpeg"
    assert len(response.content) > 1000


def test_ai_tts_empty_text_validation(client):
    response = client.get("/api/v1/ai/tts?text=   ")
    assert response.status_code == 400
    assert "cannot be empty" in response.json()["detail"]


def test_ai_tts_cache_header(client):
    # First call generates or caches
    res1 = client.get("/api/v1/ai/tts?text=Test+caching+behavior&voice=female")
    assert res1.status_code == 200
    
    # Second call returns from cache
    res2 = client.get("/api/v1/ai/tts?text=Test+caching+behavior&voice=female")
    assert res2.status_code == 200
    assert res2.headers.get("x-tts-source") == "cache"
