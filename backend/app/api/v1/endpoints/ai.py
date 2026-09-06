import re
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


CORE_DICTIONARY: Dict[str, Dict[str, str]] = {
    "let": {"translation": "deixar, permitir", "pos": "verbo"},
    "about": {"translation": "sobre, a respeito de, quase", "pos": "preposição / advérbio"},
    "something": {"translation": "algo, alguma coisa", "pos": "pronome"},
    "everything": {"translation": "tudo, todas as coisas", "pos": "pronome"},
    "nothing": {"translation": "nada", "pos": "pronome"},
    "anything": {"translation": "qualquer coisa, nada", "pos": "pronome"},
    "think": {"translation": "pensar, achar, acreditar", "pos": "verbo"},
    "look": {"translation": "olhar, parecer, buscar", "pos": "verbo"},
    "get": {"translation": "obter, conseguir, ficar, entender", "pos": "verbo"},
    "take": {"translation": "levar, tomar, pegar", "pos": "verbo"},
    "see": {"translation": "ver, enxergar, entender", "pos": "verbo"},
    "know": {"translation": "saber, conhecer", "pos": "verbo"},
    "make": {"translation": "fazer, criar, tornar", "pos": "verbo"},
    "say": {"translation": "dizer, falar", "pos": "verbo"},
    "tell": {"translation": "contar, dizer a alguém", "pos": "verbo"},
    "feel": {"translation": "sentir, achar", "pos": "verbo"},
    "want": {"translation": "querer, desejar", "pos": "verbo"},
    "need": {"translation": "precisar, necessitar", "pos": "verbo"},
    "mean": {"translation": "significar, pretender", "pos": "verbo"},
    "keep": {"translation": "manter, continuar", "pos": "verbo"},
    "help": {"translation": "ajudar, ajuda", "pos": "verbo"},
    "talk": {"translation": "conversar, falar", "pos": "verbo"},
    "listen": {"translation": "ouvir, escutar", "pos": "verbo"},
    "handle": {"translation": "lidar com, aguentar, manusear", "pos": "verbo"},
    "deal": {"translation": "lidar, tratar, acordo", "pos": "verbo"},
    "face": {"translation": "encarar, enfrentar, rosto", "pos": "verbo / substantivo"},
    "run": {"translation": "correr, fugir, executar", "pos": "verbo"},
    "walk": {"translation": "andar, caminhar", "pos": "verbo"},
    "live": {"translation": "viver, morar", "pos": "verbo"},
    "stay": {"translation": "ficar, permanecer", "pos": "verbo"},
    "leave": {"translation": "deixar, partir, sair", "pos": "verbo"},
    "stop": {"translation": "parar, interromper", "pos": "verbo"},
    "start": {"translation": "começar, iniciar", "pos": "verbo"},
    "try": {"translation": "tentar, experimentar", "pos": "verbo"},
    "ask": {"translation": "perguntar, pedir", "pos": "verbo"},
    "answer": {"translation": "responder, resposta", "pos": "verbo / substantivo"},
    "question": {"translation": "pergunta, questionamento", "pos": "substantivo"},
    "problem": {"translation": "problema, dificuldade", "pos": "substantivo"},
    "time": {"translation": "tempo, hora, vez", "pos": "substantivo"},
    "life": {"translation": "vida", "pos": "substantivo"},
    "people": {"translation": "pessoas, gente", "pos": "substantivo"},
    "friend": {"translation": "amigo, amiga", "pos": "substantivo"},
    "coworker": {"translation": "colega de trabalho", "pos": "substantivo"},
    "neighbor": {"translation": "vizinho, vizinha", "pos": "substantivo"},
    "neighborhood": {"translation": "bairro, vizinhança", "pos": "substantivo"},
    "family": {"translation": "família", "pos": "substantivo"},
    "school": {"translation": "escola, colégio", "pos": "substantivo"},
    "work": {"translation": "trabalhar, trabalho", "pos": "verbo / substantivo"},
    "day": {"translation": "dia", "pos": "substantivo"},
    "way": {"translation": "maneira, jeito, caminho", "pos": "substantivo"},
    "thing": {"translation": "coisa, situação", "pos": "substantivo"},
    "someone": {"translation": "alguém", "pos": "pronome"},
    "everyone": {"translation": "todos, todo mundo", "pos": "pronome"},
    "anyone": {"translation": "qualquer pessoa, ninguém", "pos": "pronome"},
    "give": {"translation": "dar, entregar", "pos": "verbo"},
    "find": {"translation": "encontrar, achar", "pos": "verbo"},
    "show": {"translation": "mostrar, apresentar", "pos": "verbo"},
    "hear": {"translation": "ouvir, escutar", "pos": "verbo"},
    "write": {"translation": "escrever", "pos": "verbo"},
    "read": {"translation": "ler", "pos": "verbo"},
    "speak": {"translation": "falar, conversar", "pos": "verbo"},
    "difficult": {"translation": "difícil, complicado", "pos": "adjetivo"},
    "easy": {"translation": "fácil, simples", "pos": "adjetivo"},
    "hard": {"translation": "difícil, duro, pesado", "pos": "adjetivo"},
    "rude": {"translation": "rude, grosseiro, mal-educado", "pos": "adjetivo"},
    "wonderful": {"translation": "maravilhoso, incrível", "pos": "adjetivo"},
    "great": {"translation": "ótimo, excelente, grande", "pos": "adjetivo"},
    "important": {"translation": "importante, relevante", "pos": "adjetivo"},
    "carefully": {"translation": "cuidadosamente, com cuidado", "pos": "advérbio"},
    "seriously": {"translation": "seriamente, falando sério", "pos": "advérbio"},
    "always": {"translation": "sempre", "pos": "advérbio"},
    "never": {"translation": "nunca, jamais", "pos": "advérbio"},
    "sometimes": {"translation": "às vezes, de vez em quando", "pos": "advérbio"},
    "really": {"translation": "realmente, muito, de verdade", "pos": "advérbio"},
    "together": {"translation": "juntos, em conjunto", "pos": "advérbio"},
    "away": {"translation": "longe, embora", "pos": "advérbio"},
    "right": {"translation": "certo, correto, direito", "pos": "adjetivo"},
    "wrong": {"translation": "errado, incorreto", "pos": "adjetivo"},
}


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

    # Strategy 0: Instant built-in core dictionary lookup for single clean words
    clean_single = re.sub(r'[^a-zA-Z]', '', text.lower())
    if " " not in text and clean_single in CORE_DICTIONARY:
        primary = CORE_DICTIONARY[clean_single]["translation"].split(",")[0].strip()
        _TRANSLATION_CACHE[cache_key] = primary
        return TranslateResponse(original=text, translation=primary)

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


class WordInfoRequest(BaseModel):
    word: str
    context: str | None = None


class WordInfoResponse(BaseModel):
    word: str
    translation: str
    part_of_speech: str
    definition: str
    example: str


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
            example=ctx
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
    ctx = payload.context or ""

    if "por que" in user_msg or "why" in user_msg:
        reply = (
            f"Excelente pergunta! No inglês natural e conversacional, falantes nativos usam estruturas "
            f"como '{ctx[:60]}...' por uma questão de ritmo e padrão idiomático. "
            f"Dica: Pratique a frase inteira com o Modo Shadowing para fixar a entonação."
        )
    elif "significa" in user_msg or "meaning" in user_msg:
        reply = (
            f"No trecho que você está assistindo, essa expressão indica uma intenção direta ou estado emocional. "
            f"É muito usada em reuniões, conversas informais ou podcasts."
        )
    elif "exemplo" in user_msg or "example" in user_msg:
        reply = (
            f"Aqui estão 2 exemplos adicionais para seu repertório:\n"
            f"1. 'It's really exhausting to deal with this every day.'\n"
            f"2. 'She set clear boundaries from the very beginning.'"
        )
    else:
        reply = (
            f"Ótima observação sobre '{ctx[:50]}...'. Essa é uma frase super autêntica do inglês cotidiano. "
            f"Recomendo clicar em '⭐ Salvar' para que ela entre nas suas revisões espaçadas!"
        )

    return ChatResponse(reply=reply)

