import io
import re
import urllib.parse
from typing import Any, Dict, List, Optional
import requests
import edge_tts
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from app.api.deps import get_current_user
from app.models.user import User
from app.services.dictionary_data import (
    CORE_DICTIONARY,
    PHRASAL_VERBS_AND_CHUNKS,
    lookup_local_translation,
)

router = APIRouter()

# In-memory neural TTS audio cache (text -> mp3 bytes) for instant zero-latency repeat playback
_TTS_CACHE: Dict[str, bytes] = {}

VOICE_MAP = {
    "male": "en-US-ChristopherNeural",
    "female": "en-US-JennyNeural",
    "guy": "en-US-GuyNeural",
    "ava": "en-US-AvaNeural",
    "british_male": "en-GB-RyanNeural",
    "british_female": "en-GB-SoniaNeural",
    "pt_female": "pt-BR-FranciscaNeural",
    "pt_male": "pt-BR-AntonioNeural",
}

# In-memory translation cache to guarantee instant responses and avoid rate limits
_TRANSLATION_CACHE: Dict[str, str] = {}


class TranslateRequest(BaseModel):
    text: str


class TranslateResponse(BaseModel):
    original: str
    translation: str


class ExplainRequest(BaseModel):
    text: str
    context: str | None = None


class ExplainResponse(BaseModel):
    sentence: str
    explanation: str
    examples: list[str]


class ExampleRequest(BaseModel):
    text: str


class ExampleResponse(BaseModel):
    original: str
    example: str
    translation: str = ""


@router.post("/translate", response_model=TranslateResponse)
def translate_text(
    payload: TranslateRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Translates English sentence or term to Portuguese with idiomatic chunk lookup
    and multiple online fallbacks.
    """
    text = payload.text.strip()
    if not text:
        return TranslateResponse(original="", translation="")

    # Check cache first
    cache_key = text.lower()
    if cache_key in _TRANSLATION_CACHE and _TRANSLATION_CACHE[cache_key].strip().lower() != cache_key:
        return TranslateResponse(original=text, translation=_TRANSLATION_CACHE[cache_key])

    # Strategy 0: Instant built-in idiomatic phrasal verb & core dictionary lookup
    local_hit = lookup_local_translation(text)
    if local_hit and local_hit.strip().lower() != cache_key:
        _TRANSLATION_CACHE[cache_key] = local_hit
        return TranslateResponse(original=text, translation=local_hit)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }

    # Strategy 1: Google Translate Chrome dictionary client
    try:
        encoded_query = urllib.parse.quote(text)
        url = f"https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=pt&dt=t&q={encoded_query}"
        res = requests.get(url, headers=headers, timeout=4)
        if res.status_code == 200:
            data = res.json()
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = "".join([part[0] for part in data[0] if part and len(part) > 0 and part[0]])
                if translated and translated.strip().lower() != text.lower():
                    _TRANSLATION_CACHE[cache_key] = translated
                    return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 1 Translation error: {e}")

    # Strategy 2: Google translate gtx with browser headers
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q={urllib.parse.quote(text)}"
        res = requests.get(url, headers=headers, timeout=4)
        if res.status_code == 200:
            data = res.json()
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = "".join([part[0] for part in data[0] if part and len(part) > 0 and part[0]])
                if translated and translated.strip().lower() != text.lower():
                    _TRANSLATION_CACHE[cache_key] = translated
                    return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 2 Translation error: {e}")

    # Strategy 3: Google translate webapp client
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=webapp&sl=en&tl=pt&dt=t&q={urllib.parse.quote(text)}"
        res = requests.get(url, headers=headers, timeout=4)
        if res.status_code == 200:
            data = res.json()
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = "".join([part[0] for part in data[0] if part and len(part) > 0 and part[0]])
                if translated and translated.strip().lower() != text.lower():
                    _TRANSLATION_CACHE[cache_key] = translated
                    return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 3 Translation error: {e}")

    # Strategy 4: MyMemory Translation API
    try:
        res = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": "en|pt-BR"},
            timeout=4
        )
        if res.status_code == 200:
            data = res.json()
            translated = data.get("responseData", {}).get("translatedText")
            if translated and translated.strip().lower() != text.lower() and "MYMEMORY WARNING" not in translated.upper():
                _TRANSLATION_CACHE[cache_key] = translated
                return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 4 Translation error: {e}")

    # Strategy 5: Single-word dictionary fallback ONLY (never mangle multi-word expressions)
    if " " not in text:
        clean_tok = re.sub(r'[^a-zA-Z]', '', text.lower())
        if clean_tok in CORE_DICTIONARY:
            fallback_trans = CORE_DICTIONARY[clean_tok]["translation"].split(",")[0].strip()
            _TRANSLATION_CACHE[cache_key] = fallback_trans
            return TranslateResponse(original=text, translation=fallback_trans)

    return TranslateResponse(original=text, translation=text)


def translate_batch(terms: List[str], batch_size: int = 15) -> Dict[str, str]:
    """
    Translate a list of English terms into Portuguese using grouped newline requests
    to minimize external HTTP calls and avoid rate limits on shared cloud IPs.
    """
    results: Dict[str, str] = {}
    remaining: List[str] = []

    for term in terms:
        clean = (term or "").strip()
        if not clean:
            continue
        cache_key = clean.lower()
        if cache_key in _TRANSLATION_CACHE and _TRANSLATION_CACHE[cache_key].strip().lower() != cache_key:
            results[term] = _TRANSLATION_CACHE[cache_key]
            continue
        local_hit = lookup_local_translation(clean)
        if local_hit and local_hit.strip().lower() != cache_key:
            _TRANSLATION_CACHE[cache_key] = local_hit
            results[term] = local_hit
            continue
        remaining.append(term)

    if not remaining:
        return results

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }

    for start in range(0, len(remaining), batch_size):
        chunk = remaining[start : start + batch_size]
        joined = "\n".join(chunk)
        batch_resolved = False

        for client_id in ("gtx", "dict-chrome-ex"):
            try:
                url = (
                    f"https://translate.googleapis.com/translate_a/single"
                    f"?client={client_id}&sl=en&tl=pt&dt=t&q={urllib.parse.quote(joined)}"
                )
                res = requests.get(url, headers=headers, timeout=6)
                if res.status_code != 200:
                    continue
                data = res.json()
                if not (data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list)):
                    continue
                translated_block = "".join([part[0] for part in data[0] if part and len(part) > 0 and part[0]])
                lines = [ln.strip() for ln in translated_block.splitlines()]
                if len(lines) == len(chunk):
                    for orig, tr in zip(chunk, lines):
                        if tr and tr.lower() != orig.strip().lower():
                            _TRANSLATION_CACHE[orig.strip().lower()] = tr
                            results[orig] = tr
                    batch_resolved = True
                    break
            except Exception as e:
                print(f"Batch translation notice ({client_id}): {e}")

        if not batch_resolved:
            # Individual fallback only for terms not resolved in batch
            for orig in chunk:
                if orig in results:
                    continue
                try:
                    single_res = translate_text(TranslateRequest(text=orig), current_user=None)
                    if single_res.translation and single_res.translation.strip().lower() != orig.strip().lower():
                        results[orig] = single_res.translation.strip()
                except Exception:
                    pass

    return results


@router.post("/explain", response_model=ExplainResponse)
def explain_text(
    payload: ExplainRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Provides a concise, practical English explanation focusing on:
    - Meaning in context
    - Natural breakdown of chunks/phrasal verbs
    - Pronunciation and connected speech tip
    """
    sentence = payload.text.strip()
    words = sentence.split()
    lower_s = sentence.lower()

    # Detect common structures or phrasal verbs
    phrasal_tips = []
    from app.services.vocabulary import COMMON_PHRASAL_VERBS_AND_CHUNKS
    for chunk in COMMON_PHRASAL_VERBS_AND_CHUNKS:
        if re.search(r'\b' + re.escape(chunk) + r'\b', lower_s):
            phrasal_tips.append(chunk)

    chunks_explanation = ""
    if phrasal_tips:
        chunks_explanation = f" Destaca-se a expressão/phrasal verb '{', '.join(phrasal_tips)}', muito frequente no inglês diário."

    # Connected speech / pronunciation tip
    pron_tip = ""
    if re.search(r'\b(gonna|wanna|gotta|kinda)\b', lower_s):
        pron_tip = " Note o uso de reduções de fala conectada (ex: gonna/wanna), que tornam o ritmo mais rápido e informal."
    elif re.search(r'\b(to|at|for|of|and)\b', lower_s):
        pron_tip = " Em inglês falado, preposições curtas como 'to', 'at' ou 'for' costumam ser pronunciadas de forma reduzida (som 'schwa' /ə/)."

    explanation = (
        f"A frase '{sentence}' expressa uma ideia natural do inglês conversacional cotidiana.{chunks_explanation}"
        f"{pron_tip} Em vez de traduzir palavra por palavra, memorize o padrão como um bloco único para pensar diretamente em inglês."
    )

    examples = [
        f"In real conversations, you can adapt this pattern naturally: '{sentence}'",
        f"Practice shadowing this exact rhythm aloud to train your mouth muscles."
    ]

    return ExplainResponse(
        sentence=sentence,
        explanation=explanation,
        examples=examples
    )


@router.post("/example", response_model=ExampleResponse)
def generate_example_sentence(
    payload: ExampleRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Generates a natural, real-world conversational example sentence for a given word or expression.
    Uses multi-stage fallback:
    1. Google Dictionary / Oxford real native sentences
    2. Tatoeba human-curated sentence database
    3. Built-in Core Dictionary tips
    4. Contextual conversational smart synthesizer
    """
    term = payload.text.strip()
    if not term:
        return ExampleResponse(original="", example="", translation="")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }

    # Strategy 1: Google Chrome Oxford Dictionary example
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=pt&dt=ex&dt=md&q={urllib.parse.quote(term)}"
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, list):
                        for sub in item:
                            if isinstance(sub, list) and len(sub) > 1 and isinstance(sub[1], list):
                                for def_item in sub[1]:
                                    if isinstance(def_item, list) and len(def_item) > 2 and isinstance(def_item[2], str):
                                        candidate = def_item[2].strip()
                                        if candidate and len(candidate) > 10:
                                            sentence = candidate[0].upper() + candidate[1:]
                                            if not sentence.endswith((".", "!", "?")):
                                                sentence += "."
                                            return ExampleResponse(original=term, example=sentence)
    except Exception as e:
        print(f"Example Strategy 1 error: {e}")

    # Strategy 2: Tatoeba API
    try:
        url = f"https://tatoeba.org/en/api_v0/search?from=eng&query={urllib.parse.quote(term)}"
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            results = res.json().get("results", [])
            for r in results:
                txt = r.get("text", "").strip()
                if txt and term.lower() in txt.lower() and len(txt) >= 12:
                    return ExampleResponse(original=term, example=txt)
    except Exception as e:
        print(f"Example Strategy 2 error: {e}")

    # Strategy 3: Built-in Core Dictionary tips
    clean_w = re.sub(r'[^a-zA-Z]', '', term.lower())
    if clean_w in CORE_DICTIONARY:
        tip = CORE_DICTIONARY[clean_w].get("tip", "")
        quote_match = re.search(r"['\"]([^'\"]+)['\"]", tip)
        if quote_match:
            ex = quote_match.group(1).strip()
            if len(ex) > 8:
                sentence = ex[0].upper() + ex[1:]
                if not sentence.endswith((".", "!", "?")):
                    sentence += "."
                return ExampleResponse(original=term, example=sentence)

    # Strategy 4: High quality conversational patterns
    if " " in term:
        sentence = f"In conversational English, native speakers frequently say '{term}'."
    else:
        sentence = f"Learning how to use '{term}' properly will significantly improve your fluency."

    return ExampleResponse(original=term, example=sentence)


class WordInfoRequest(BaseModel):
    word: str
    context: str | None = None


class WordInfoResponse(BaseModel):
    word: str
    translation: str
    part_of_speech: str
    definition: str
    example: str
    tip: str = ""


class ChatRequest(BaseModel):
    message: str
    context: str | None = None


class ChatResponse(BaseModel):
    reply: str


@router.post("/word-info", response_model=WordInfoResponse)
def get_word_info(
    payload: WordInfoRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Instant dictionary lookup for words clicked in transcripts.
    """
    word = payload.word.strip().lower()
    clean_w = re.sub(r'[^a-zA-Z]', '', word)

    # 1. Check built-in core dictionary
    if clean_w in CORE_DICTIONARY:
        entry = CORE_DICTIONARY[clean_w]
        ctx = payload.context or f"This is an example with {clean_w}."
        return WordInfoResponse(
            word=clean_w,
            translation=entry["translation"],
            part_of_speech=entry["pos"],
            definition=f"Em português: '{entry['translation']}'.",
            example=ctx,
            tip=entry.get("tip", "")
        )

    # 2. Translate word with robust multi-engine
    tr = translate_text(TranslateRequest(text=clean_w), current_user=current_user)
    portuguese = tr.translation if tr.translation.lower() != clean_w.lower() else ""

    # 3. If translation returned same word, try direct MyMemory translation
    if not portuguese:
        try:
            res = requests.get(
                "https://api.mymemory.translated.net/get",
                params={"q": clean_w, "langpair": "en|pt-BR"},
                timeout=5
            )
            if res.status_code == 200:
                t = res.json().get("responseData", {}).get("translatedText")
                if t and t.lower() != clean_w.lower():
                    portuguese = t
        except Exception:
            pass

    if not portuguese:
        portuguese = clean_w

    pos = "termo"
    if clean_w.endswith("ly"):
        pos = "advérbio"
    elif clean_w.endswith("ing") or clean_w.endswith("ed"):
        pos = "verbo"
    elif clean_w.endswith("tion") or clean_w.endswith("ment") or clean_w.endswith("ness"):
        pos = "substantivo"
    elif clean_w.endswith("ful") or clean_w.endswith("able") or clean_w.endswith("ive") or clean_w.endswith("ous"):
        pos = "adjetivo"

    ctx = payload.context or f"Example with {clean_w}."

    return WordInfoResponse(
        word=clean_w,
        translation=portuguese,
        part_of_speech=pos,
        definition=f"Significa '{portuguese}' em português.",
        example=ctx
    )


@router.post("/chat", response_model=ChatResponse)
def chat_with_tutor(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Contextual AI Tutor for questions regarding grammar, phrases, and video dialogue.
    """
    user_msg = payload.message.strip().lower()
    ctx = (payload.context or "").strip()

    from app.services.vocabulary import COMMON_PHRASAL_VERBS_AND_CHUNKS

    # Check if context contains phrasal verbs
    found_chunks = [c for c in COMMON_PHRASAL_VERBS_AND_CHUNKS if re.search(r'\b' + re.escape(c) + r'\b', ctx.lower())]

    if "por que" in user_msg or "why" in user_msg:
        reply = (
            f"No inglês real, usamos estruturas como '{ctx[:50]}...' por uma questão de fluidez natural e ritmo. "
            f"Falantes nativos evitam traduções literais e usam blocos prontos (chunks). "
            f"Dica de ouro do Mr. English Channel: repita a frase em voz alta 3 vezes focando na melodia da fala!"
        )
    elif "chunk" in user_msg or "expressão" in user_msg or "expressao" in user_msg or "phrasal" in user_msg:
        if found_chunks:
            reply = f"Neste trecho temos a expressão/phrasal verb de ouro: '{found_chunks[0]}'. Guarde o bloco inteiro em vez de traduzir cada palavra separadamente!"
        else:
            reply = f"Em '{ctx[:45]}...', tente memorizar as palavras juntas como uma ideia única para pensar mais rápido sem traduzir."
    elif "pronúncia" in user_msg or "pronuncia" in user_msg or "falar" in user_msg or "som" in user_msg:
        reply = (
            f"Dica de pronúncia para '{ctx[:45]}...': atente-se às junções de palavras (connected speech). "
            f"Palavras que terminam em som de consoante costumam se ligar à palavra seguinte se ela começar com som de vogal."
        )
    elif "exemplo" in user_msg or "example" in user_msg:
        reply = (
            f"Aqui estão 2 exemplos adicionais para seu repertório:\n"
            f"1. 'It's totally normal to feel that way at first.'\n"
            f"2. 'We need to figure out what happened as soon as possible.'"
        )
    elif "significa" in user_msg or "meaning" in user_msg:
        reply = (
            f"No contexto de '{ctx[:50]}...', essa expressão comunica uma ideia prática do dia a dia. "
            f"Recomendo clicar na palavra ou salvar a frase para fixar no modo Cloze de repetição espaçada!"
        )
    else:
        reply = (
            f"Excelente observação sobre '{ctx[:50]}...'. Essa é uma frase super autêntica! "
            f"Pratique com o botão de Gravação de Voz (Shadowing) para comparar sua pronúncia e ritmo com o áudio nativo."
        )

    return ChatResponse(reply=reply)


def _split_tts_chunks(text: str, max_len: int = 180) -> List[str]:
    """Split longer sentences cleanly for Google TTS endpoint limits."""
    words = text.split()
    chunks: List[str] = []
    current = ""
    for w in words:
        candidate = f"{current} {w}".strip() if current else w
        if len(candidate) <= max_len:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = w
    if current:
        chunks.append(current)
    return chunks or [text[:max_len]]


def _fetch_gtts_audio(text: str, lang_code: str) -> bytes:
    """Server-side fallback using Google Translate TTS returning valid MP3 bytes."""
    audio_parts: List[bytes] = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
    for chunk in _split_tts_chunks(text):
        res = requests.get(
            "https://translate.google.com/translate_tts",
            params={"ie": "UTF-8", "q": chunk, "tl": lang_code, "client": "tw-ob"},
            headers=headers,
            timeout=6,
        )
        if res.status_code == 200 and res.content:
            audio_parts.append(res.content)
    return b"".join(audio_parts)


@router.get("/tts")
async def text_to_speech(
    text: str = Query(..., description="The phrase or word to synthesize"),
    voice: Optional[str] = Query("male", description="Voice ID or shortcut: male, female, guy, ava, british_male, british_female, pt_female, pt_male"),
    rate: Optional[str] = Query("+0%", description="Speech speed adjustment: +0%, -15%, +10%"),
    lang: Optional[str] = Query(None, description="Optional language override: en or pt"),
):
    """
    Synthesize natural, human-grade speech audio using Azure Neural TTS,
    with automatic Google TTS server-side fallback for uninterrupted background audio.
    """
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    # Resolve voice name and language
    resolved_voice = VOICE_MAP.get((voice or "").lower().strip(), voice) or "en-US-ChristopherNeural"
    clean_rate = rate.strip() if rate else "+0%"
    resolved_lang = (lang or ("pt" if resolved_voice.lower().startswith("pt-") else "en")).lower().strip()

    cache_key = f"{resolved_voice}_{clean_rate}_{resolved_lang}_{clean_text.lower()}"
    if cache_key in _TTS_CACHE:
        return Response(
            content=_TTS_CACHE[cache_key],
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=86400",
                "Content-Disposition": "inline; filename=speech.mp3",
                "X-TTS-Source": "cache"
            }
        )

    audio_bytes = b""
    tts_source = "neural"

    try:
        communicate = edge_tts.Communicate(clean_text, resolved_voice, rate=clean_rate)
        audio_stream = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])
        audio_bytes = audio_stream.getvalue()
    except Exception as e:
        print(f"Neural TTS notice (trying GTTS fallback): {e}")

    if not audio_bytes:
        try:
            gtts_lang = "pt-BR" if resolved_lang.startswith("pt") else "en"
            audio_bytes = _fetch_gtts_audio(clean_text, gtts_lang)
            tts_source = "gtts-fallback"
        except Exception as fallback_err:
            print(f"GTTS fallback notice: {fallback_err}")

    if not audio_bytes:
        raise HTTPException(status_code=500, detail="TTS generation error: unable to synthesize speech")

    if len(_TTS_CACHE) < 1000:
        _TTS_CACHE[cache_key] = audio_bytes

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": "inline; filename=speech.mp3",
            "X-TTS-Source": tts_source
        }
    )


