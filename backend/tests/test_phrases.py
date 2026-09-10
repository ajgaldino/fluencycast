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


def test_create_word_deduplication_across_different_videos(client):
    headers = get_auth_headers(client, email="cross_video_dedup@fluencycast.com")
    
    # Save word under video_id 1
    p1 = {
        "text": "mastery",
        "translation": "domínio",
        "phrase_type": "WORD",
        "video_id": "vid-111"
    }
    res1 = client.post("/api/v1/phrases/", json=p1, headers=headers)
    assert res1.status_code == 201
    id1 = res1.json()["id"]

    # Save SAME word under video_id 2
    p2 = {
        "text": "MASTERY",
        "translation": "maestria",
        "phrase_type": "WORD",
        "video_id": "vid-222"
    }
    res2 = client.post("/api/v1/phrases/", json=p2, headers=headers)
    assert res2.status_code == 201
    data2 = res2.json()
    assert data2["id"] == id1  # Same card returned without creating a duplicate!
    
    # Query all words: only ONE card exists in the deck!
    res_list = client.get("/api/v1/phrases/?phrase_type=WORD", headers=headers)
    words = [p["text"].lower() for p in res_list.json()]
    assert words.count("mastery") == 1


def test_extract_keywords_no_duplicates_across_videos(db_session):
    from app.models.user import User
    from app.models.video import Video
    from app.models.transcript import TranscriptSegment
    from app.services.vocabulary import extract_keywords_for_video, get_video_filter_condition
    from app.models.phrase import SavedPhrase

    # Setup user
    user = User(email="keyword_dedup@test.com", hashed_password="pw", full_name="Tester")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Setup Video 1
    v1 = Video(user_id=user.id, youtube_id="yt111", url="https://youtube.com/watch?v=yt111", title="Video 1")
    db_session.add(v1)
    db_session.commit()
    db_session.refresh(v1)

    seg1 = TranscriptSegment(video_id=v1.id, sequence=1, start_time=0.0, end_time=2.0, text="This is a great challenge and journey.")
    db_session.add(seg1)
    db_session.commit()

    # Setup Video 2
    v2 = Video(user_id=user.id, youtube_id="yt222", url="https://youtube.com/watch?v=yt222", title="Video 2")
    db_session.add(v2)
    db_session.commit()
    db_session.refresh(v2)

    seg2 = TranscriptSegment(video_id=v2.id, sequence=1, start_time=0.0, end_time=2.0, text="Another challenge awaits our destiny.")
    db_session.add(seg2)
    db_session.commit()

    # Extract keywords for Video 1
    k1 = extract_keywords_for_video(v1.id, user.id, db_session)
    words_v1 = [p.text.lower() for p in k1]
    assert "challenge" in words_v1

    # Extract keywords for Video 2
    k2 = extract_keywords_for_video(v2.id, user.id, db_session)
    words_v2 = [p.text.lower() for p in k2]
    # "challenge" was already in Video 1, so it MUST NOT be recreated in Video 2!
    assert "challenge" not in words_v2
    assert "destiny" in words_v2

    # Verify total cards in database for user: "challenge" appears exactly ONCE
    all_user_words = db_session.query(SavedPhrase).filter(SavedPhrase.user_id == user.id, SavedPhrase.phrase_type == "WORD").all()
    card_texts = [p.text.lower() for p in all_user_words]
    assert card_texts.count("challenge") == 1

    # Verify video filter condition for Video 2 includes both "destiny" and "challenge"
    cond_v2 = get_video_filter_condition(v2.id, user.id, db_session)
    v2_cards = db_session.query(SavedPhrase).filter(SavedPhrase.user_id == user.id, cond_v2).all()
    v2_card_texts = [p.text.lower() for p in v2_cards]
    assert "challenge" in v2_card_texts
    assert "destiny" in v2_card_texts


def test_auto_repair_untranslated_phrases(client, db_session):
    from app.services.vocabulary import auto_repair_untranslated_phrases
    from app.models.user import User
    from app.models.phrase import SavedPhrase

    # Get or create user
    headers = get_auth_headers(client, email="repair_user@fluencycast.com")
    user = db_session.query(User).filter(User.email == "repair_user@fluencycast.com").first()

    # Create phrases with broken translations (untranslated word identical to text)
    p1 = SavedPhrase(
        user_id=user.id,
        text="quick",
        translation="quick",
        phrase_type="WORD",
        status="NEW"
    )
    p2 = SavedPhrase(
        user_id=user.id,
        text="small",
        translation="Sem tradução cadastrada",
        phrase_type="WORD",
        status="NEW"
    )
    p3 = SavedPhrase(
        user_id=user.id,
        text="safe",
        translation="",
        phrase_type="WORD",
        status="NEW"
    )
    db_session.add_all([p1, p2, p3])
    db_session.commit()

    # Run auto-repair
    repaired = auto_repair_untranslated_phrases(user.id, db_session)
    assert repaired >= 3

    db_session.refresh(p1)
    db_session.refresh(p2)
    db_session.refresh(p3)

    assert p1.translation != "quick"
    assert "rápido" in p1.translation
    assert "pequeno" in p2.translation
    assert "seguro" in p3.translation

