import pytest
from app.services.youtube import extract_video_id, segment_transcript, clean_text


def test_extract_video_id():
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    with pytest.raises(ValueError):
        extract_video_id("https://invalid-url.com")


def test_segment_transcript():
    raw = [
        {"text": "Hello world", "start": 0.0, "duration": 1.5, "end": 1.5},
        {"text": "this is a test.", "start": 1.6, "duration": 1.2, "end": 2.8},
        {"text": "Second sentence.", "start": 4.5, "duration": 2.0, "end": 6.5},
    ]
    segments = segment_transcript(raw)
    assert len(segments) == 2
    assert segments[0]["text"] == "Hello world this is a test."
    assert segments[0]["start_time"] == 0.0
    assert segments[0]["end_time"] == 2.8
    assert segments[1]["text"] == "Second sentence."
    assert segments[1]["start_time"] == 4.5


def test_create_video_invalid_url(client):
    # Register & Login user
    email = "videotest@fluencycast.com"
    pwd = "ValidPassword123"
    client.post("/api/v1/auth/register", json={"email": email, "password": pwd, "full_name": "Video User"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    token = login_res.json()["access_token"]

    response = client.post(
        "/api/v1/videos/",
        json={"url": "https://not-youtube.com/watch?v=123", "category": "video"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 400
