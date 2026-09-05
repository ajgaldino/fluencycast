import html
import re
from typing import Dict, Any, List, Optional
import requests
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled,
    NoTranscriptFound,
    CouldNotRetrieveTranscript,
    VideoUnavailable
)


def extract_video_id(url: str) -> str:
    """
    Extract YouTube video ID from various URL formats:
    - https://www.youtube.com/watch?v=dQw4w9WgXcQ
    - https://youtu.be/dQw4w9WgXcQ
    - https://www.youtube.com/shorts/dQw4w9WgXcQ
    - https://www.youtube.com/embed/dQw4w9WgXcQ
    - https://music.youtube.com/watch?v=dQw4w9WgXcQ
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL inválida.")

    url = url.strip()

    # If user passes directly an 11-char video ID
    if re.fullmatch(r"[a-zA-Z0-9_-]{11}", url):
        return url

    patterns = [
        r"(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?.*?v=|embed\/|v\/|shorts\/)([a-zA-Z0-9_-]{11})",
        r"(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})",
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    raise ValueError("Não foi possível identificar o ID do vídeo do YouTube. Verifique o link informado.")


def get_video_metadata(video_id: str) -> Dict[str, Any]:
    """
    Fetch public metadata via YouTube official oEmbed endpoint (no API key required).
    """
    oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    thumbnail_fallback = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"

    try:
        response = requests.get(oembed_url, timeout=8)
        if response.status_code == 200:
            data = response.json()
            return {
                "title": data.get("title", f"YouTube Video ({video_id})"),
                "channel": data.get("author_name", "YouTube Creator"),
                "thumbnail_url": data.get("thumbnail_url", thumbnail_fallback),
            }
    except Exception as e:
        print(f"oEmbed fetch error for {video_id}: {e}")

    return {
        "title": f"YouTube Video ({video_id})",
        "channel": "YouTube",
        "thumbnail_url": thumbnail_fallback,
    }


def clean_text(raw_text: str) -> str:
    """
    Decodes HTML entities and normalizes whitespace.
    """
    if not raw_text:
        return ""
    text = html.unescape(raw_text)
    # Remove music note symbols if present
    text = text.replace("♪", "").replace("♫", "")
    # Normalize multiple whitespaces and newlines
    text = re.sub(r"\s+", " ", text).strip()
    if text in ["[]", "()", "[ ]", "( )", "[Music]", "[music]"]:
        return ""
    return text


def fetch_transcript(video_id: str) -> List[Dict[str, Any]]:
    """
    Fetch official or auto-generated transcript using youtube-transcript-api.
    Supports both v0.6.x (dict) and v1.x (FetchedTranscript / dataclass).
    """
    api = YouTubeTranscriptApi()

    try:
        # First attempt English variations
        try:
            raw_transcript = api.fetch(video_id, languages=["en", "en-US", "en-GB", "en-CA", "en-AU"])
        except Exception:
            # Fallback: list all available transcript tracks
            transcript_list = api.list(video_id)
            # Find any english track or generated track, otherwise the first track
            en_transcript = None
            for t in transcript_list:
                if t.language_code.startswith("en"):
                    en_transcript = t
                    break
            if not en_transcript:
                # Get the first available
                for t in transcript_list:
                    en_transcript = t
                    break

            if en_transcript:
                raw_transcript = en_transcript.fetch()
            else:
                raise NoTranscriptFound(video_id, ["en"])

    except TranscriptsDisabled:
        print(f"[YouTube] Transcripts disabled by author for video: {video_id}")
        raise ValueError("O autor deste vídeo desativou as legendas no YouTube.")
    except NoTranscriptFound:
        print(f"[YouTube] No English transcript found for video: {video_id}")
        raise ValueError("Este vídeo não possui legendas disponíveis em inglês.")
    except VideoUnavailable:
        print(f"[YouTube] Video unavailable: {video_id}")
        raise ValueError("Este vídeo está indisponível, privado ou foi removido do YouTube.")
    except CouldNotRetrieveTranscript as e:
        error_name = type(e).__name__
        print(f"[YouTube] Could not retrieve transcript ({error_name}) for {video_id}: {e}")
        if "IpBlocked" in error_name or "blocking requests from your IP" in str(e):
            raise ValueError("O YouTube bloqueou temporariamente requisições deste servidor em nuvem (Render IP ban).")
        raise ValueError(f"Não foi possível obter legendas para este vídeo: {str(e)}")
    except Exception as e:
        print(f"[YouTube] Unexpected error for {video_id}: {type(e).__name__} - {e}")
        raise ValueError(f"Erro ao processar vídeo: {str(e)}")

    parsed_items = []
    for item in raw_transcript:
        text = getattr(item, "text", None) or (item.get("text") if isinstance(item, dict) else "")
        start = getattr(item, "start", None) or (item.get("start") if isinstance(item, dict) else 0.0)
        duration = getattr(item, "duration", None) or (item.get("duration") if isinstance(item, dict) else 0.0)

        cleaned = clean_text(text)
        if cleaned:
            parsed_items.append({
                "text": cleaned,
                "start": float(start),
                "duration": float(duration),
                "end": float(start) + float(duration)
            })

    if not parsed_items:
        raise ValueError("A transcrição do vídeo está vazia ou inacessível.")

    return parsed_items


def segment_transcript(raw_items: List[Dict[str, Any]], max_gap_seconds: float = 1.8, max_words: int = 18) -> List[Dict[str, Any]]:
    """
    Intelligently merges short subtitle fragments into coherent, readable sentences
    punctuated with correct start and end timestamps.
    """
    if not raw_items:
        return []

    segmented = []
    current_words = []
    current_start = raw_items[0]["start"]
    current_end = raw_items[0]["end"]

    def finish_segment():
        nonlocal current_words, current_start, current_end
        if current_words:
            sentence_text = " ".join(current_words).strip()
            if sentence_text:
                segmented.append({
                    "sequence": len(segmented) + 1,
                    "text": sentence_text,
                    "start_time": round(current_start, 2),
                    "end_time": round(current_end, 2)
                })
            current_words = []

    for i, item in enumerate(raw_items):
        item_text = item["text"]
        words = item_text.split()

        # Check pause gap from previous item
        time_gap = item["start"] - current_end if current_words else 0

        # If there's a significant pause or current sentence is getting long
        if current_words and (time_gap > max_gap_seconds or len(current_words) >= max_words):
            finish_segment()
            current_start = item["start"]

        if not current_words:
            current_start = item["start"]

        current_words.extend(words)
        current_end = max(current_end, item["end"])

        # Check if text ends with sentence delimiter (. ? !)
        if item_text.endswith((".", "?", "!")):
            finish_segment()

    # Finish any remaining words
    finish_segment()

    return segmented


def split_segment_into_sentences(text: str, start: float, end: float, max_words: int = 12) -> List[Dict[str, Any]]:
    """
    Fragments long sentences and multi-sentence blocks into bite-sized, readable phrases
    with accurately calculated proportional timestamps.
    """
    text = clean_text(text)
    if not text:
        return []

    # Split by end of sentence punctuation (. ! ?)
    raw_sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
    if not raw_sentences:
        raw_sentences = [text]

    final_pieces = []
    for s in raw_sentences:
        words = s.split()
        if len(words) > max_words:
            # Try splitting by comma, semicolon, or dash
            subparts = [p.strip() for p in re.split(r'(?<=[,;—])\s+', s) if p.strip()]
            if len(subparts) > 1 and all(len(p.split()) <= max_words + 4 for p in subparts):
                final_pieces.extend(subparts)
            else:
                final_pieces.append(s)
        else:
            final_pieces.append(s)

    total_len = sum(len(p) for p in final_pieces) or 1
    total_dur = max(0.6, end - start)

    results = []
    curr_start = start
    for p in final_pieces:
        p_dur = (len(p) / total_len) * total_dur
        p_end = curr_start + p_dur
        results.append({
            "text": p,
            "start_time": round(curr_start, 2),
            "end_time": round(p_end, 2)
        })
        curr_start = p_end

    return results


def parse_transcript_text(text: str) -> List[Dict[str, Any]]:
    """
    Parses manually pasted transcript text into structured, bite-sized segments:
    - Supports timestamped lines like '0:12 Some sentence' or '0:12\\nSome sentence'
    - Automatically fragments long multi-sentence paragraphs into concise phrases
    """
    if not text or not text.strip():
        return []

    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    raw_blocks = []

    has_timestamps = any(re.search(r'\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b', line) for line in lines)

    if has_timestamps:
        curr_time = None
        curr_text = []

        for line in lines:
            # Inline: 0:15 text or 1:02:15 text
            m_inline = re.match(r'^(?:(?:(\d{1,2}):)?(\d{1,2}):(\d{2}))\s+(.+)$', line)
            # Standalone: 0:15 or 1:02:15
            m_alone = re.match(r'^(?:(?:(\d{1,2}):)?(\d{1,2}):(\d{2}))$', line)

            if m_inline:
                if curr_time is not None and curr_text:
                    raw_blocks.append({'start': curr_time, 'text': ' '.join(curr_text).strip()})
                    curr_text = []
                h = int(m_inline.group(1) or 0)
                m_ = int(m_inline.group(2))
                s = int(m_inline.group(3))
                curr_time = h * 3600 + m_ * 60 + s
                curr_text = [m_inline.group(4)]
            elif m_alone:
                if curr_time is not None and curr_text:
                    raw_blocks.append({'start': curr_time, 'text': ' '.join(curr_text).strip()})
                    curr_text = []
                h = int(m_alone.group(1) or 0)
                m_ = int(m_alone.group(2))
                s = int(m_alone.group(3))
                curr_time = h * 3600 + m_ * 60 + s
            else:
                if curr_time is not None:
                    curr_text.append(line)

        if curr_time is not None and curr_text:
            raw_blocks.append({'start': curr_time, 'text': ' '.join(curr_text).strip()})

        for i in range(len(raw_blocks)):
            end = raw_blocks[i + 1]['start'] if i + 1 < len(raw_blocks) else raw_blocks[i]['start'] + 4.0
            raw_blocks[i]['end'] = round(max(end, raw_blocks[i]['start'] + 1.0), 2)

        # Now fragment raw blocks into concise, bite-sized sentences
        fragmented = []
        for block in raw_blocks:
            sub_pieces = split_segment_into_sentences(block['text'], block['start'], block['end'])
            fragmented.extend(sub_pieces)

        for i, item in enumerate(fragmented):
            item['sequence'] = i + 1

        return fragmented
    else:
        # Plain text without timestamps
        start = 0.0
        fragmented = []
        for line in lines:
            dur = max(2.5, len(line.split()) * 0.45)
            end = start + dur
            sub_pieces = split_segment_into_sentences(line, start, end)
            fragmented.extend(sub_pieces)
            start = end

        for i, item in enumerate(fragmented):
            item['sequence'] = i + 1

        return fragmented


