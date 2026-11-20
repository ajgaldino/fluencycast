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


def test_create_video_stream_progress(client, monkeypatch):
    import json
    from app.api.v1.endpoints import videos as videos_endpoint

    email = "streamtest@fluencycast.com"
    pwd = "ValidPassword123"
    client.post("/api/v1/auth/register", json={"email": email, "password": pwd, "full_name": "Stream Tester"})
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    token = login_res.json()["access_token"]

    monkeypatch.setattr(
        videos_endpoint,
        "get_video_metadata",
        lambda vid: {
            "title": "Mr. English Stream Test",
            "channel": "Mr. English Channel",
            "thumbnail_url": f"https://img.youtube.com/vi/{vid}/hqdefault.jpg",
        },
    )

    response = client.post(
        "/api/v1/videos/stream",
        json={
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "category": "video",
            "raw_transcript": "0:00 Learning English every morning helps build confidence and plan your future.\n0:06 Good morning friend, share your honest opinion today.",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")

    events = [
        json.loads(line[len("data: "):])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert len(events) >= 5

    progress_values = [ev["progress"] for ev in events if "progress" in ev]
    assert progress_values == sorted(progress_values)

    stages = {ev.get("stage") for ev in events if ev.get("type") == "progress"}
    assert {"metadata", "transcript", "saving", "keywords", "finalizing"}.issubset(stages)

    final_event = events[-1]
    assert final_event["type"] == "complete"
    assert final_event["progress"] == 100
    assert final_event["segments_count"] >= 2
    assert final_event["video"]["id"]
    assert final_event["video"]["title"] == "Mr. English Stream Test"


def test_extract_keywords_full_video_coverage_and_idioms(db_session):
    from app.models.user import User
    from app.models.video import Video
    from app.models.transcript import TranscriptSegment
    from app.services.vocabulary import extract_keywords_for_video

    user = User(email="fullcover@fluencycast.com", hashed_password="pw", full_name="Coverage Tester")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    video = Video(
        user_id=user.id,
        youtube_id="fullcover1",
        url="https://youtube.com/watch?v=fullcover1",
        title="Full Coverage Podcast",
        duration=960.0,
    )
    db_session.add(video)
    db_session.commit()
    db_session.refresh(video)

    segments_data = [
        (1, 8.0, 14.0, "Hello everyone and welcome back to Mr. English Channel. I'm Emily."),
        (2, 15.0, 22.0, "Hi Emily, I'm Paul and today's conversation is easy and fun."),
        (3, 60.0, 75.0, "Sometimes you feel overwhelmed and hesitate to share your honest opinion."),
        (4, 150.0, 165.0, "Don't put off your goals when small mistakes seem discouraging."),
        (5, 240.0, 260.0, "We slowly figured out why people compare their progress unfairly."),
        (6, 360.0, 380.0, "Everything fell apart briefly, yet patience and courage brought clarity."),
        (7, 480.0, 500.0, "That advice actually makes sense when you gain perspective over time."),
        (8, 600.0, 620.0, "Negative anxiety almost took over, so consistent routine gave relief."),
        (9, 720.0, 745.0, "Staying grateful and humble builds real confidence and inner strength."),
        (10, 840.0, 865.0, "Even embarrassed learners eventually celebrate meaningful growth and freedom."),
        (11, 900.0, 950.0, "Moving on from perfectionism requires kindness, curiosity, and resilience."),
    ]
    for seq, start, end, text in segments_data:
        db_session.add(TranscriptSegment(video_id=video.id, sequence=seq, start_time=start, end_time=end, text=text))
    db_session.commit()

    phrases = extract_keywords_for_video(video.id, user.id, db_session, max_keywords=30)
    by_text = {p.text.lower(): p for p in phrases}

    # 1. Intro boilerplate and speaker names are filtered out
    for banned in ("emily", "paul", "channel", "english", "everyone"):
        assert banned not in by_text

    # 2. Inflected phrasal verbs/chunks are matched AND translated idiomatically (not single-verb)
    assert "put off" in by_text
    assert "adiar" in by_text["put off"].translation.lower()

    assert "figure out" in by_text
    assert "descobrir" in by_text["figure out"].translation.lower()

    assert "fall apart" in by_text
    assert "desmoronar" in by_text["fall apart"].translation.lower()

    assert "make sense" in by_text
    assert "sentido" in by_text["make sense"].translation.lower()

    assert "take over" in by_text
    assert "assumir" in by_text["take over"].translation.lower()

    # 3. Words cover later portions of the video rather than clustering under 40s
    word_timestamps = [p.timestamp for p in phrases if p.phrase_type == "WORD" and p.timestamp is not None]
    assert word_timestamps
    assert max(word_timestamps) >= 480.0


def test_extract_keywords_refresh_preserves_sentences_and_reviewed(db_session):
    from app.models.user import User
    from app.models.video import Video
    from app.models.transcript import TranscriptSegment
    from app.models.phrase import SavedPhrase
    from app.services.vocabulary import extract_keywords_for_video

    user = User(email="refreshcover@fluencycast.com", hashed_password="pw", full_name="Refresh Tester")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    video = Video(
        user_id=user.id,
        youtube_id="refreshvid1",
        url="https://youtube.com/watch?v=refreshvid1",
        title="Refresh Video",
        duration=300.0,
    )
    db_session.add(video)
    db_session.commit()
    db_session.refresh(video)

    seg = TranscriptSegment(
        video_id=video.id,
        sequence=1,
        start_time=20.0,
        end_time=40.0,
        text="Consistent patience helps build confidence and overcome sudden fear.",
    )
    db_session.add(seg)
    db_session.commit()

    # Pre-existing cards: 1 unreviewed NEW WORD, 1 reviewed WORD, 1 saved SENTENCE
    old_new_word = SavedPhrase(
        user_id=user.id,
        video_id=video.id,
        transcript_segment_id=seg.id,
        text="emily",
        translation="Significado em contexto",
        phrase_type="WORD",
        status="NEW",
        repetitions=0,
    )
    studied_word = SavedPhrase(
        user_id=user.id,
        video_id=video.id,
        transcript_segment_id=seg.id,
        text="confidence",
        translation="confiança",
        phrase_type="WORD",
        status="LEARNING",
        repetitions=2,
    )
    saved_sentence = SavedPhrase(
        user_id=user.id,
        video_id=video.id,
        transcript_segment_id=seg.id,
        text="Consistent patience helps build confidence.",
        translation="Paciência consistente ajuda a construir confiança.",
        phrase_type="SENTENCE",
        status="NEW",
        repetitions=0,
    )
    db_session.add_all([old_new_word, studied_word, saved_sentence])
    db_session.commit()

    extract_keywords_for_video(video.id, user.id, db_session, refresh=True)

    remaining = db_session.query(SavedPhrase).filter(SavedPhrase.video_id == video.id).all()
    remaining_texts = [p.text for p in remaining]
    assert "emily" not in remaining_texts
    assert "confidence" in remaining_texts
    assert "Consistent patience helps build confidence." in remaining_texts


def test_translate_no_literal_single_verb_for_phrases(monkeypatch):
    import requests as req_lib
    from app.api.v1.endpoints.ai import translate_text, TranslateRequest

    # Force network calls to fail so only local dictionaries/fallbacks run
    monkeypatch.setattr(req_lib, "get", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("offline")))

    # Known idiomatic expressions resolve cleanly
    assert "sentido" in translate_text(TranslateRequest(text="make sense"), current_user=None).translation.lower()
    assert "aparecer" in translate_text(TranslateRequest(text="show up"), current_user=None).translation.lower()

    # Unknown multi-word phrase must NOT return a broken single-verb literal translation like "fazer"
    unknown = translate_text(TranslateRequest(text="make xylophoneblorp"), current_user=None).translation
    assert unknown == "make xylophoneblorp"


def test_auto_repair_offline_never_blocks_get_requests(db_session, monkeypatch):
    import requests as req_lib
    from app.models.user import User
    from app.models.phrase import SavedPhrase
    from app.services.vocabulary import auto_repair_untranslated_phrases

    # Ensure GET-path auto-repair makes ZERO external network calls
    monkeypatch.setattr(
        req_lib,
        "get",
        lambda *a, **kw: (_ for _ in ()).throw(AssertionError("GET auto-repair must not make external HTTP calls")),
    )

    user = User(email="offlinerepair@fluencycast.com", hashed_password="pw", full_name="Offline Repair")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    p1 = SavedPhrase(user_id=user.id, text="business", translation="Significado em contexto", phrase_type="WORD", status="NEW")
    p2 = SavedPhrase(user_id=user.id, text="probably", translation="Significado em contexto", phrase_type="WORD", status="NEW")
    p3 = SavedPhrase(user_id=user.id, text="put off", translation="Significado em contexto", phrase_type="PHRASAL_VERB", status="NEW")
    p4 = SavedPhrase(user_id=user.id, text="unheardofxyzterm", translation="Significado em contexto", phrase_type="WORD", status="NEW")
    db_session.add_all([p1, p2, p3, p4])
    db_session.commit()

    repaired = auto_repair_untranslated_phrases(user.id, db_session)
    assert repaired == 3
    db_session.refresh(p1)
    db_session.refresh(p2)
    db_session.refresh(p3)
    db_session.refresh(p4)
    assert p1.translation == "negócio"
    assert p2.translation == "provavelmente"
    assert "adiar" in p3.translation.lower()
    assert p4.translation == "Significado em contexto"



