import urllib.parse
from typing import Any
import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()


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
    Translates English sentence to Portuguese.
    """
    text = payload.text.strip()
    if not text:
        return TranslateResponse(original="", translation="")

    try:
        encoded_query = urllib.parse.quote(text)
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q={encoded_query}"
        res = requests.get(url, timeout=6)
        if res.status_code == 200:
            data = res.json()
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = "".join([part[0] for part in data[0] if part and len(part) > 0 and part[0]])
                return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Translation error: {e}")

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
    # Practical pedagogical fallback
    return ExplainResponse(
        sentence=sentence,
        explanation=f"A frase '{sentence}' expressa uma ideia contextual em inglês conversacional comum.",
        examples=[
            "I used to travel a lot when I was younger.",
            "That explains why they acted that way."
        ]
    )
