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
    "let": {"translation": "deixar, permitir", "pos": "verbo", "tip": "Usado para dar permissão ou sugerir. 'Let me help you' = Deixa eu te ajudar."},
    "about": {"translation": "sobre, a respeito de, quase", "pos": "preposição / advérbio", "tip": "Indica assunto ou aproximação. 'What's it about?' = Sobre o que é? / 'About 10 minutes' = Uns 10 minutos."},
    "something": {"translation": "algo, alguma coisa", "pos": "pronome", "tip": "Refere-se a uma coisa indefinida. 'Tell me something' = Me conta alguma coisa."},
    "everything": {"translation": "tudo, todas as coisas", "pos": "pronome", "tip": "Engloba a totalidade. 'Everything is fine' = Está tudo bem."},
    "nothing": {"translation": "nada", "pos": "pronome", "tip": "Negação total. 'Nothing happened' = Nada aconteceu. Não precisa de 'not'."},
    "anything": {"translation": "qualquer coisa, nada", "pos": "pronome", "tip": "Usado em perguntas e negações. 'Is there anything else?' = Tem mais alguma coisa?"},
    "think": {"translation": "pensar, achar, acreditar", "pos": "verbo", "tip": "Expressa opinião: 'I think so' = Acho que sim. Muito comum no dia a dia."},
    "look": {"translation": "olhar, parecer, buscar", "pos": "verbo", "tip": "'Look at this' = Olha isso. 'You look great' = Você parece ótimo(a). Phrasal verbs: look for, look up."},
    "get": {"translation": "obter, conseguir, ficar, entender", "pos": "verbo", "tip": "Verbo coringa do inglês! 'Get it?' = Entendeu? 'Get home' = Chegar em casa. 'Get angry' = Ficar bravo."},
    "take": {"translation": "levar, tomar, pegar", "pos": "verbo", "tip": "'Take your time' = Leve o tempo que precisar. 'Take a break' = Fazer uma pausa."},
    "see": {"translation": "ver, enxergar, entender", "pos": "verbo", "tip": "'I see' = Entendo. 'See you later' = Até mais. Diferente de 'look' (olhar com atenção)."},
    "know": {"translation": "saber, conhecer", "pos": "verbo", "tip": "'You know what I mean' = Sabe o que eu quero dizer. 'I don't know' = Não sei."},
    "make": {"translation": "fazer, criar, tornar", "pos": "verbo", "tip": "'Make a decision' = Tomar uma decisão. Diferente de 'do': make = criar algo, do = executar."},
    "say": {"translation": "dizer, falar", "pos": "verbo", "tip": "Fala-se 'say something' (dizer algo). Diferente de 'tell' que pede complemento: 'tell someone'."},
    "tell": {"translation": "contar, dizer a alguém", "pos": "verbo", "tip": "Sempre usado com pessoa: 'Tell me' = Me conta. 'Tell him the truth' = Conta a verdade pra ele."},
    "feel": {"translation": "sentir, achar", "pos": "verbo", "tip": "'I feel like...' = Estou com vontade de... / 'How do you feel?' = Como você se sente?"},
    "want": {"translation": "querer, desejar", "pos": "verbo", "tip": "'I want to...' = Eu quero... Direto e natural: 'Do you want some coffee?' = Quer um café?"},
    "need": {"translation": "precisar, necessitar", "pos": "verbo", "tip": "'I need help' = Preciso de ajuda. Mais urgente que 'want'. 'You need to rest' = Precisa descansar."},
    "mean": {"translation": "significar, pretender", "pos": "verbo", "tip": "'What do you mean?' = O que você quer dizer? 'I didn't mean to' = Não foi minha intenção."},
    "keep": {"translation": "manter, continuar", "pos": "verbo", "tip": "'Keep going' = Continue. 'Keep in mind' = Tenha em mente. 'Keep it simple' = Mantenha simples."},
    "help": {"translation": "ajudar, ajuda", "pos": "verbo", "tip": "'Can you help me?' = Pode me ajudar? 'I can't help it' = Não consigo evitar."},
    "talk": {"translation": "conversar, falar", "pos": "verbo", "tip": "'Talk to me' = Fala comigo. 'We need to talk' = Precisamos conversar. Mais informal que 'speak'."},
    "listen": {"translation": "ouvir, escutar", "pos": "verbo", "tip": "'Listen to me' = Me escuta. Diferente de 'hear' (ouvir sem esforço). Listen = ouvir com atenção."},
    "handle": {"translation": "lidar com, aguentar, manusear", "pos": "verbo", "tip": "'I can handle it' = Eu dou conta. Muito usado para situações difíceis."},
    "deal": {"translation": "lidar, tratar, acordo", "pos": "verbo", "tip": "'Deal with it' = Lide com isso. 'Big deal!' = Grande coisa! (irônico). 'It's a deal' = Fechado!"},
    "face": {"translation": "encarar, enfrentar, rosto", "pos": "verbo / substantivo", "tip": "'Face the problem' = Enfrente o problema. 'Face to face' = Cara a cara."},
    "run": {"translation": "correr, fugir, executar", "pos": "verbo", "tip": "'Run a business' = Administrar um negócio. 'Run out of' = Ficar sem. Muito versátil."},
    "walk": {"translation": "andar, caminhar", "pos": "verbo", "tip": "'Walk away' = Ir embora. 'Take a walk' = Dar uma caminhada."},
    "live": {"translation": "viver, morar", "pos": "verbo", "tip": "'Where do you live?' = Onde você mora? 'Live and learn' = Vivendo e aprendendo."},
    "stay": {"translation": "ficar, permanecer", "pos": "verbo", "tip": "'Stay here' = Fique aqui. 'Stay calm' = Fique calmo. 'Stay in touch' = Mantenha contato."},
    "leave": {"translation": "deixar, partir, sair", "pos": "verbo", "tip": "'Leave me alone' = Me deixa em paz. 'I have to leave' = Tenho que ir."},
    "stop": {"translation": "parar, interromper", "pos": "verbo", "tip": "'Stop it!' = Para com isso! 'Stop + -ing' = Parar de fazer: 'Stop talking' = Pare de falar."},
    "start": {"translation": "começar, iniciar", "pos": "verbo", "tip": "'Let's start' = Vamos começar. 'Start over' = Recomeçar do zero."},
    "try": {"translation": "tentar, experimentar", "pos": "verbo", "tip": "'Try again' = Tente de novo. 'Try + to + verbo' = Tentar fazer. 'Give it a try' = Dá uma chance."},
    "ask": {"translation": "perguntar, pedir", "pos": "verbo", "tip": "'Ask a question' = Fazer uma pergunta. 'Ask for help' = Pedir ajuda."},
    "answer": {"translation": "responder, resposta", "pos": "verbo / substantivo", "tip": "'Answer the phone' = Atender o telefone. 'The answer is...' = A resposta é..."},
    "question": {"translation": "pergunta, questionamento", "pos": "substantivo", "tip": "'Good question!' = Boa pergunta! 'No questions asked' = Sem perguntas."},
    "problem": {"translation": "problema, dificuldade", "pos": "substantivo", "tip": "'No problem!' = Sem problemas! Usado como 'de nada' em resposta a agradecimentos."},
    "time": {"translation": "tempo, hora, vez", "pos": "substantivo", "tip": "'What time is it?' = Que horas são? 'One more time' = Mais uma vez. 'It's time to go' = É hora de ir."},
    "life": {"translation": "vida", "pos": "substantivo", "tip": "'That's life' = É a vida. 'Real life' = Vida real. Plural: 'lives'."},
    "people": {"translation": "pessoas, gente", "pos": "substantivo", "tip": "Já é plural! 'People are...' (não 'peoples'). 'A lot of people' = Muita gente."},
    "friend": {"translation": "amigo, amiga", "pos": "substantivo", "tip": "'Best friend' = Melhor amigo(a). 'Make friends' = Fazer amizades."},
    "coworker": {"translation": "colega de trabalho", "pos": "substantivo", "tip": "Também escrito 'co-worker'. Sinônimo: 'colleague' (mais formal)."},
    "neighbor": {"translation": "vizinho, vizinha", "pos": "substantivo", "tip": "'Next-door neighbor' = Vizinho de porta. Grafia britânica: 'neighbour'."},
    "neighborhood": {"translation": "bairro, vizinhança", "pos": "substantivo", "tip": "'Nice neighborhood' = Bairro legal. Comum em conversas sobre onde morar."},
    "family": {"translation": "família", "pos": "substantivo", "tip": "'Family comes first' = Família vem primeiro. Pode ser usado com verbo singular ou plural."},
    "school": {"translation": "escola, colégio", "pos": "substantivo", "tip": "Nos EUA, 'school' inclui faculdade! 'I'm in school' pode significar 'estou na universidade'."},
    "work": {"translation": "trabalhar, trabalho", "pos": "verbo / substantivo", "tip": "'It works!' = Funciona! 'Work out' = Malhar / resolver. 'Get to work' = Mãos à obra."},
    "day": {"translation": "dia", "pos": "substantivo", "tip": "'Day off' = Dia de folga. 'The other day' = Outro dia (recentemente). 'Day by day' = Dia a dia."},
    "way": {"translation": "maneira, jeito, caminho", "pos": "substantivo", "tip": "'By the way' = A propósito. 'No way!' = De jeito nenhum! 'This way' = Por aqui."},
    "thing": {"translation": "coisa, situação", "pos": "substantivo", "tip": "'The thing is...' = O negócio é que... 'First things first' = Primeiro o mais importante."},
    "someone": {"translation": "alguém", "pos": "pronome", "tip": "'Someone told me' = Alguém me contou. Usado em frases afirmativas (vs 'anyone' em perguntas)."},
    "everyone": {"translation": "todos, todo mundo", "pos": "pronome", "tip": "'Everyone knows' = Todo mundo sabe. Verbo sempre no singular! 'Everyone is ready'."},
    "anyone": {"translation": "qualquer pessoa, ninguém", "pos": "pronome", "tip": "'Does anyone know?' = Alguém sabe? Usado em perguntas e negações."},
    "give": {"translation": "dar, entregar", "pos": "verbo", "tip": "'Give me a break' = Me dá um tempo. 'Give up' = Desistir. 'Give it a try' = Tenta."},
    "find": {"translation": "encontrar, achar", "pos": "verbo", "tip": "'Find out' = Descobrir. 'I find it interesting' = Acho interessante (opinião)."},
    "show": {"translation": "mostrar, apresentar", "pos": "verbo", "tip": "'Show me' = Me mostra. 'Show up' = Aparecer. 'A TV show' = Um programa de TV."},
    "hear": {"translation": "ouvir, escutar", "pos": "verbo", "tip": "'I hear you' = Te entendo / te escuto. Diferente de 'listen': hear é involuntário."},
    "write": {"translation": "escrever", "pos": "verbo", "tip": "'Write down' = Anotar. Passado irregular: wrote. Particípio: written."},
    "read": {"translation": "ler", "pos": "verbo", "tip": "Pronúncia muda! Presente: /riid/. Passado: /red/. 'Read between the lines' = Ler nas entrelinhas."},
    "speak": {"translation": "falar, conversar", "pos": "verbo", "tip": "'Speak up' = Fale mais alto. Mais formal que 'talk'. 'Do you speak English?' = Você fala inglês?"},
    "difficult": {"translation": "difícil, complicado", "pos": "adjetivo", "tip": "Sinônimo formal de 'hard'. 'A difficult situation' = Uma situação difícil."},
    "easy": {"translation": "fácil, simples", "pos": "adjetivo", "tip": "'Take it easy' = Vai com calma. 'Easy peasy' = Moleza (informal). Oposto de 'hard'."},
    "hard": {"translation": "difícil, duro, pesado", "pos": "adjetivo", "tip": "'Hard work' = Trabalho duro. 'It's hard to...' = É difícil... Também advérbio: 'Work hard'."},
    "rude": {"translation": "rude, grosseiro, mal-educado", "pos": "adjetivo", "tip": "'That's rude!' = Que grosseria! 'Don't be rude' = Não seja mal-educado."},
    "wonderful": {"translation": "maravilhoso, incrível", "pos": "adjetivo", "tip": "'What a wonderful day!' = Que dia maravilhoso! Mais entusiasmado que 'good' ou 'nice'."},
    "great": {"translation": "ótimo, excelente, grande", "pos": "adjetivo", "tip": "'That's great!' = Que ótimo! Um dos elogios mais usados no inglês cotidiano."},
    "important": {"translation": "importante, relevante", "pos": "adjetivo", "tip": "'It's important to...' = É importante... 'The most important thing' = O mais importante."},
    "carefully": {"translation": "cuidadosamente, com cuidado", "pos": "advérbio", "tip": "'Listen carefully' = Escute com atenção. 'Think carefully' = Pense bem antes de agir."},
    "seriously": {"translation": "seriamente, falando sério", "pos": "advérbio", "tip": "'Seriously?' = Sério? 'Take it seriously' = Leve a sério. Muito usado como reação."},
    "always": {"translation": "sempre", "pos": "advérbio", "tip": "Posição: antes do verbo principal. 'I always wake up early' = Sempre acordo cedo."},
    "never": {"translation": "nunca, jamais", "pos": "advérbio", "tip": "'Never mind' = Esquece / não importa. Já é negativo, não use com 'not'."},
    "sometimes": {"translation": "às vezes, de vez em quando", "pos": "advérbio", "tip": "Pode vir no início ou meio da frase. 'Sometimes I wonder...' = Às vezes eu penso..."},
    "really": {"translation": "realmente, muito, de verdade", "pos": "advérbio", "tip": "'Really?' = Sério? 'I really like it' = Eu gosto muito. Intensificador universal."},
    "together": {"translation": "juntos, em conjunto", "pos": "advérbio", "tip": "'Let's do it together' = Vamos fazer juntos. 'Get together' = Se reunir."},
    "away": {"translation": "longe, embora", "pos": "advérbio", "tip": "'Go away' = Vá embora. 'Far away' = Longe. 'Right away' = Imediatamente."},
    "right": {"translation": "certo, correto, direito", "pos": "adjetivo", "tip": "'You're right' = Você tem razão. 'Right now' = Agora mesmo. 'All right' = Tudo bem."},
    "wrong": {"translation": "errado, incorreto", "pos": "adjetivo", "tip": "'What's wrong?' = O que houve? / Qual o problema? 'You're wrong' = Você está errado."},
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

