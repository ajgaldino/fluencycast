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


def test_parse_transcript_text_user_brazilian_format():
    from app.services.youtube import parse_transcript_text

    user_raw = """0:011 segundo[music]
0:055 segundos[music]
0:088 segundosHello everyone and welcome back to Mr.
0:1212 segundosEnglish [music] channel where learning English is easy and fun. I'm Emily.
0:1818 segundosHello Emily. Hi everyone. [music] I'm Paul and I am so ready for today's chat.
0:2424 segundosMe too Paul. Today we are talking about something we do every single day."""

    segments = parse_transcript_text(user_raw)
    assert len(segments) == 4

    assert segments[0]["start_time"] == 8.0
    assert segments[0]["end_time"] == 12.0
    assert segments[0]["text"] == "Hello everyone and welcome back to Mr."

    assert segments[1]["start_time"] == 12.0
    assert segments[1]["end_time"] == 18.0
    assert "[music]" not in segments[1]["text"]
    assert "English channel where learning English is easy and fun. I'm Emily." in segments[1]["text"]

    assert segments[2]["start_time"] == 18.0
    assert segments[2]["end_time"] == 24.0

    assert segments[3]["start_time"] == 24.0
    assert segments[3]["end_time"] >= 26.0


def test_parse_transcript_text_srt_and_vtt():
    from app.services.youtube import parse_transcript_text

    srt_sample = """1
00:00:05,000 --> 00:00:09,500
Hello and welcome.

2
00:00:10,000 --> 00:00:15,000
Second subtitle line."""

    segments = parse_transcript_text(srt_sample)
    assert len(segments) == 2
    assert segments[0]["start_time"] == 5.0
    assert segments[0]["end_time"] == 9.5
    assert segments[0]["text"] == "Hello and welcome."
    assert segments[1]["start_time"] == 10.0
    assert segments[1]["end_time"] == 15.0


def test_parse_transcript_text_standalone_seconds_label():
    from app.services.youtube import parse_transcript_text

    raw = """40segundosYes.AndforEnglishlearners,it'stheperfectplacetopracticespeakingbecausetheconversationsareshort,right?Youdon'tneedahugevocabulary.
1 minuto e 5 segundosSecond phrase."""

    segments = parse_transcript_text(raw)
    assert len(segments) == 2
    assert segments[0]["start_time"] == 40.0
    assert segments[0]["end_time"] <= 65.0
    assert "40segundos" not in segments[0]["text"]
    assert "40 segundos" not in segments[0]["text"]
    assert segments[0]["text"].startswith("Yes.")

    assert segments[1]["start_time"] == 65.0
    assert "minuto" not in segments[1]["text"]
    assert segments[1]["text"] == "Second phrase."


def test_parse_transcript_text_compound_minutes_and_seconds():
    from app.services.youtube import parse_transcript_text

    raw = """1:051 minuto e 5 segundosIt's not a deep philosophical debate.
1:081 minuto e 8 segundosRight. It's just a friendly way to fill the silence and to connect with someone.
1:401 minuto e 40 segundosYes. And for English learners, it's the perfect place to practice speaking because the conversations are short, right? You don't need a huge vocabulary.
5:005 minutosAnd then you could just say, "Yes, it's my favorite." And the conversation ends nicely."""

    segments = parse_transcript_text(raw)
    assert len(segments) == 4

    assert segments[0]["start_time"] == 65.0
    assert segments[0]["text"] == "It's not a deep philosophical debate."
    assert "segundo" not in segments[0]["text"].lower()
    assert "minuto" not in segments[0]["text"].lower()

    assert segments[1]["start_time"] == 68.0
    assert segments[1]["text"].startswith("Right. It's just a friendly way")
    assert "segundo" not in segments[1]["text"].lower()

    assert segments[2]["start_time"] == 100.0
    assert segments[2]["text"].startswith("Yes. And for English learners")
    assert "segundo" not in segments[2]["text"].lower()
    assert "40" not in segments[2]["text"]

    assert segments[3]["start_time"] == 300.0
    assert segments[3]["text"].startswith('And then you could just say, "Yes, it\'s my favorite."')



