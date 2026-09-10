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


def clean_transcript_token(text: str) -> str:
    """
    Cleans HTML entities, tags, speaker markers, sound brackets, residual timestamps and labels.
    """
    if not text:
        return ""
    # Unescape HTML entities (&amp;, &#39;, etc.)
    text = html.unescape(text)
    # Remove HTML tags (e.g. <font color="...">, <c.color...>, <v Speaker>)
    text = re.sub(r'<[^>]+>', ' ', text)
    # Remove brackets sound annotations like [music], [Música], (Applause), [Laughter], etc.
    text = re.sub(
        r'\[\s*(?:music|música|musica|applause|aplausos|laughter|risos|som|áudio|choro|gritos|silêncio|gasp|sigh|cheering|cough)\s*\]',
        ' ',
        text,
        flags=re.IGNORECASE
    )
    text = re.sub(
        r'\(\s*(?:music|música|musica|applause|aplausos|laughter|risos|som|áudio)\s*\)',
        ' ',
        text,
        flags=re.IGNORECASE
    )
    # Remove music symbols
    text = text.replace('♪', ' ').replace('♫', ' ')
    # Remove speaker arrows like >> or >>>
    text = re.sub(r'^(?:>>|>>>|\>)\s*', '', text)
    # Strip any leading residual timestamp or duration e.g. "40segundos", "0:40", "0:4040segundos", "8 segundos"
    text = re.sub(
        r'^(?:(?:(?:\d{1,2}:)?\d{1,2}:\d{2})|\d+)\s*(?:segundos?|seconds?|minutos?|minutes?|horas?|hours?|s|m)?(?:\s*(?:e|and)\s*\d+\s*(?:segundos?|seconds?))?\s*[-–:]?\s*',
        '',
        text,
        flags=re.IGNORECASE
    )
    # Add space after punctuation if glued to word (e.g. "Yes.And" -> "Yes. And")
    text = re.sub(r'([.?!,;:])([A-Za-z])', r'\1 \2', text)
    # Normalize whitespaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def parse_time_str(ts_str: str) -> float:
    """
    Parses '0:12', '00:12', '1:02:15', '01:02:15.500', '00:00:15,200' to seconds.
    """
    ts_str = ts_str.replace(',', '.')
    parts = ts_str.split(':')
    try:
        if len(parts) == 3:
            h = float(parts[0])
            m = float(parts[1])
            s = float(parts[2])
            return h * 3600 + m * 60 + s
        elif len(parts) == 2:
            m = float(parts[0])
            s = float(parts[1])
            return m * 60 + s
        elif len(parts) == 1:
            return float(parts[0])
    except Exception:
        pass
    return 0.0


def parse_transcript_text(text: str) -> List[Dict[str, Any]]:
    """
    Universal YouTube transcript parser supporting virtually any pasted format:
    1. Brazilian pt-BR concatenated: '0:088 segundosHello everyone' / '1:051 minuto e 5 segundos...'
    2. English accessibility concatenated: '0:088 secondsHello everyone'
    3. Standard multiline YouTube copy: '0:08\\nHello everyone'
    4. Inline standard copy: '0:08 Hello everyone' or '[0:08] - Hello everyone'
    5. SRT format: '00:00:08,000 --> 00:00:12,000'
    6. WebVTT format: '00:08.000 --> 00:12.000'
    7. Timestamps at end of lines: 'Hello everyone (0:08)'
    8. Plain lyrics/text without timestamps
    """
    if not text or not text.strip():
        return []

    text = text.replace('\r\n', '\n').replace('\r', '\n')
    lines = [l.strip() for l in text.split('\n') if l.strip()]

    # 1. Check for SRT / WebVTT arrow format
    arrow_re = re.compile(r'((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)')
    srt_matches = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m_arrow = arrow_re.search(line)
        if m_arrow:
            start_s = parse_time_str(m_arrow.group(1))
            end_s = parse_time_str(m_arrow.group(2))
            text_lines = []
            i += 1
            while i < len(lines) and not arrow_re.search(lines[i]) and not (lines[i].isdigit() and len(lines[i]) <= 4):
                cleaned = clean_transcript_token(lines[i])
                if cleaned:
                    text_lines.append(cleaned)
                i += 1
            if text_lines:
                srt_matches.append({
                    'start_time': round(start_s, 2),
                    'end_time': round(max(end_s, start_s + 1.2), 2),
                    'text': ' '.join(text_lines)
                })
            continue
        i += 1

    if srt_matches:
        for idx, s in enumerate(srt_matches):
            s['sequence'] = idx + 1
        return srt_matches

    # 2. General parsing: Match timestamps at beginning or end
    # Handles: '0:08', '[0:08]', '(0:08)', '0:088 segundosHello', '0:08 - Hello'
    ts_start_re = re.compile(
        r'^(?:\[|\()?((?:(?:\d{1,2}):)?\d{1,2}:\d{2}(?:[.,]\d+)?)(?:\]|\))?'
        r'(?:'
        r'\d*\s*(?:segundos?|seconds?|minutos?|minutes?|horas?|hours?|m|s)'
        r'(?:\s*(?:e|and|,)\s*\d+\s*(?:segundos?|seconds?|minutos?|minutes?))?'
        r')?'
        r'(?:\s*[-–:]\s*|\s+|$)(.*)$',
        re.IGNORECASE
    )

    # Compact start pattern (e.g. 0:011 segundo[music])
    ts_compact_re = re.compile(
        r'^(?:\[|\()?((?:(?:\d{1,2}):)?\d{1,2}:\d{2})(?:\]|\))?(.*)$'
    )

    # End timestamp pattern: 'Hello everyone (0:08)'
    ts_end_re = re.compile(
        r'^(.*?)(?:\[|\()?((?:(?:\d{1,2}):)?\d{1,2}:\d{2})(?:\]|\))?$'
    )

    accessibility_label_re = re.compile(
        r'^\d*\s*(?:segundos?|seconds?|minutos?|minutes?|horas?|hours?)(?:\s*(?:e|and|,)\s*\d+\s*(?:segundos?|seconds?))?\s*',
        re.IGNORECASE
    )

    # Standalone label timestamp without mm:ss e.g. "40segundosYes", "40 segundos Yes", "1 minuto e 5 segundos Yes"
    ts_label_only_re = re.compile(
        r'^(?:'
        r'(?:(\d+)\s*(?:horas?|hours?|h)\s*(?:e\s*)?)?'
        r'(?:(\d+)\s*(?:minutos?|minutes?|min|m)\s*(?:e\s*)?)?'
        r'(?:(\d+)\s*(?:segundos?|seconds?|seg|s))'
        r'|'
        r'(?:(?:(\d+)\s*(?:horas?|hours?|h)\s*(?:e\s*)?)?'
        r'(\d+)\s*(?:minutos?|minutes?|min|m))'
        r')\s*(.*)$',
        re.IGNORECASE
    )

    raw_entries = []  # tuples: (start_time, text_chunk)
    curr_time = None
    curr_text = []

    for line in lines:
        if line.lower() in ['webvtt', 'kind: captions', 'language: en', 'transcrição', 'transcript']:
            continue
        if line.isdigit() and len(line) <= 4:
            continue

        # Try timestamp at start
        m_start = ts_start_re.match(line) or ts_compact_re.match(line)
        if m_start:
            if curr_time is not None and curr_text:
                joined = clean_transcript_token(' '.join(curr_text))
                if joined:
                    raw_entries.append((curr_time, joined))
                curr_text = []

            curr_time = parse_time_str(m_start.group(1))
            rest = m_start.group(2) if len(m_start.groups()) >= 2 else ""
            rest = accessibility_label_re.sub('', rest).strip()
            rest_clean = clean_transcript_token(rest)
            if rest_clean:
                curr_text.append(rest_clean)
            continue

        # Try standalone duration label e.g. '40segundosYes...'
        m_label = ts_label_only_re.match(line)
        if m_label:
            if curr_time is not None and curr_text:
                joined = clean_transcript_token(' '.join(curr_text))
                if joined:
                    raw_entries.append((curr_time, joined))
                curr_text = []

            h = int(m_label.group(1) or m_label.group(4) or 0)
            mins = int(m_label.group(2) or m_label.group(5) or 0)
            secs = int(m_label.group(3) or 0)
            curr_time = float(h * 3600 + mins * 60 + secs)
            rest = m_label.group(6) or ""
            rest_clean = clean_transcript_token(rest)
            if rest_clean:
                curr_text.append(rest_clean)
            continue

        # Try timestamp at end (e.g. 'Hello everyone (0:08)')
        m_end = ts_end_re.match(line)
        if m_end and len(m_end.group(1).strip()) > 2:
            if curr_time is not None and curr_text:
                joined = clean_transcript_token(' '.join(curr_text))
                if joined:
                    raw_entries.append((curr_time, joined))
                curr_text = []

            curr_time = parse_time_str(m_end.group(2))
            rest_clean = clean_transcript_token(m_end.group(1))
            if rest_clean:
                raw_entries.append((curr_time, rest_clean))
                curr_time = None
            continue

        # Continuation line
        clean_line = accessibility_label_re.sub('', line).strip()
        clean_line = clean_transcript_token(clean_line)
        if clean_line:
            curr_text.append(clean_line)

    if curr_time is not None and curr_text:
        joined = clean_transcript_token(' '.join(curr_text))
        if joined:
            raw_entries.append((curr_time, joined))

    # 3. If no timestamps detected, fallback to plain text line-by-line
    if not raw_entries:
        segments = []
        curr_t = 0.0
        for line in lines:
            c = clean_transcript_token(line)
            if not c:
                continue
            dur = max(2.5, len(c.split()) * 0.45)
            segments.append({
                'sequence': len(segments) + 1,
                'start_time': round(curr_t, 2),
                'end_time': round(curr_t + dur, 2),
                'text': c
            })
            curr_t += dur
        return segments

    # 4. Assemble synchronized segments
    segments = []
    for idx, (start_t, txt) in enumerate(raw_entries):
        words = len(txt.split())
        est_dur = max(2.2, words * 0.42)

        if idx + 1 < len(raw_entries):
            next_start = raw_entries[idx + 1][0]
            if next_start > start_t:
                # If gap is normal (< 15s), end_time is next_start
                # If gap is huge (video jump), cap duration
                end_t = min(next_start, start_t + max(est_dur, 10.0))
            else:
                end_t = start_t + est_dur
        else:
            end_t = start_t + est_dur

        end_t = max(end_t, start_t + 1.2)

        segments.append({
            'sequence': len(segments) + 1,
            'start_time': round(start_t, 2),
            'end_time': round(end_t, 2),
            'text': txt
        })

    return segments



