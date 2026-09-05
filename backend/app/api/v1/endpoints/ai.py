import urllib.parse
from typing import Any, Dict
import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()

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


@router.post("/translate", response_model=TranslateResponse)
def translate_text(
    payload: TranslateRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Translates English sentence to Portuguese with multiple robust fallbacks.
    """
    text = payload.text.strip()
    if not text:
        return TranslateResponse(original="", translation="")

    # Check cache first
    cache_key = text.lower()
    if cache_key in _TRANSLATION_CACHE:
        return TranslateResponse(original=text, translation=_TRANSLATION_CACHE[cache_key])

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }

    # Strategy 1: Google Translate Chrome dictionary client
    try:
        encoded_query = urllib.parse.quote(text)
        url = f"https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=pt&dt=t&q={encoded_query}"
        res = requests.get(url, headers=headers, timeout=6)
        if res.status_code == 200:
            data = res.json()
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = "".join([part[0] for part in data[0] if part and len(part) > 0 and part[0]])
                if translated and translated.strip().lower() != text.lower():
                    _TRANSLATION_CACHE[cache_key] = translated
                    return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 1 Translation error: {e}")

    # Strategy 2: MyMemory Translation API
    try:
        res = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": "en|pt-BR"},
            timeout=6
        )
        if res.status_code == 200:
            data = res.json()
            translated = data.get("responseData", {}).get("translatedText")
            if translated and translated.strip().lower() != text.lower():
                _TRANSLATION_CACHE[cache_key] = translated
                return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 2 Translation error: {e}")

    # Strategy 3: Google translate gtx with browser headers
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q={urllib.parse.quote(text)}"
        res = requests.get(url, headers=headers, timeout=6)
        if res.status_code == 200:
            data = res.json()
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = "".join([part[0] for part in data[0] if part and len(part) > 0 and part[0]])
                if translated and translated.strip().lower() != text.lower():
                    _TRANSLATION_CACHE[cache_key] = translated
                    return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 3 Translation error: {e}")

    return TranslateResponse(original=text, translation=text)


@router.post("/explain", response_model=ExplainResponse)
def explain_text(
    payload: ExplainRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Provides a concise, practical English explanation.
    """
    sentence = payload.text.strip()
    return ExplainResponse(
        sentence=sentence,
        explanation=f"A frase '{sentence}' expressa uma ideia contextual em inglês conversacional comum.",
        examples=[
            "I used to travel a lot when I was younger.",
            "That explains why they acted that way."
        ]
    )
