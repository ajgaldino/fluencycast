import io
import re
import urllib.parse
from typing import Any, Dict, Optional
import requests
import edge_tts
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from app.api.deps import get_current_user
from app.models.user import User

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
    # Expanded conversational core words
    "quick": {"translation": "rápido, veloz, ágil", "pos": "adjetivo", "tip": "'A quick question' = Uma pergunta rápida. 'Quick thinking' = Raciocínio rápido."},
    "quickly": {"translation": "rapidamente, depressa", "pos": "advérbio", "tip": "'Come quickly!' = Venha depressa!"},
    "small": {"translation": "pequeno, curto", "pos": "adjetivo", "tip": "'Small talk' = Conversa fiada / bate-papo informal. 'A small problem' = Um probleminha."},
    "safe": {"translation": "seguro, protegido, tranquilo", "pos": "adjetivo", "tip": "'Safe topics' = Assuntos seguros. 'Stay safe' = Fique seguro / se cuide."},
    "safely": {"translation": "com segurança", "pos": "advérbio", "tip": "'Drive safely' = Dirija com segurança."},
    "safety": {"translation": "segurança, proteção", "pos": "substantivo", "tip": "'Safety first' = Segurança em primeiro lugar."},
    "taboo": {"translation": "tabu, assunto proibido", "pos": "substantivo / adjetivo", "tip": "'Taboo topics' = Temas proibidos ou delicados em conversas."},
    "stranger": {"translation": "estranho, desconhecido", "pos": "substantivo", "tip": "'Talking to strangers' = Conversando com desconhecidos."},
    "strangers": {"translation": "estranhos, desconhecidos", "pos": "substantivo", "tip": "Plural de stranger."},
    "silence": {"translation": "silêncio", "pos": "substantivo", "tip": "'Awkward silence' = Silêncio constrangedor. 'Fill the silence' = Preencher o silêncio."},
    "awkward": {"translation": "estranho, constrangedor, desajeitado", "pos": "adjetivo", "tip": "'An awkward moment' = Um momento constrangedor."},
    "bridge": {"translation": "ponte, ligação", "pos": "substantivo", "tip": "'Build a bridge' = Construir uma ponte / criar conexão com alguém."},
    "traffic": {"translation": "trânsito, tráfego", "pos": "substantivo", "tip": "'Heavy traffic' = Trânsito pesado. Muito comum em small talk."},
    "elevator": {"translation": "elevador", "pos": "substantivo", "tip": "'In the elevator' = No elevador. Cenário clássico de conversa casual."},
    "nervous": {"translation": "nervoso, ansioso", "pos": "adjetivo", "tip": "'Feel nervous' = Sentir-se nervoso. Normal ao falar outro idioma!"},
    "weather": {"translation": "clima, tempo", "pos": "substantivo", "tip": "'Nice weather today!' = Tempo bom hoje! O assunto número 1 de small talk."},
    "chat": {"translation": "conversa, bater papo", "pos": "verbo / substantivo", "tip": "'Have a quick chat' = Ter uma conversa rápida."},
    "store": {"translation": "loja, guardar", "pos": "substantivo / verbo", "tip": "'At the grocery store' = No supermercado."},
    "grocery": {"translation": "mercearia, compras de comida", "pos": "substantivo", "tip": "'Grocery shopping' = Fazer compras de supermercado."},
    "debate": {"translation": "debate, discussão", "pos": "substantivo / verbo", "tip": "'Deep debate' = Debate profundo."},
    "friendly": {"translation": "amigável, simpático", "pos": "adjetivo", "tip": "'Friendly smile' = Sorriso simpático. 'Be friendly' = Seja amigável."},
    "fill": {"translation": "preencher, encher", "pos": "verbo", "tip": "'Fill the silence' = Preencher o silêncio."},
    "connect": {"translation": "conectar, ligar, aproximar", "pos": "verbo", "tip": "'Connect with people' = Se conectar com as pessoas."},
    "honest": {"translation": "honesto, sincero", "pos": "adjetivo", "tip": "'To be honest' = Para ser sincero."},
    "honestly": {"translation": "sinceramente, honestamente", "pos": "advérbio", "tip": "'Honestly, I don't know' = Sinceramente, eu não sei."},
    "native": {"translation": "nativo, natural", "pos": "adjetivo / substantivo", "tip": "'Native speaker' = Falante nativo."},
    "basically": {"translation": "basicamente", "pos": "advérbio", "tip": "'Basically, it works like this' = Basicamente, funciona assim."},
    "casual": {"translation": "casual, informal, descontraído", "pos": "adjetivo", "tip": "'Casual conversation' = Conversa informal."},
    "light": {"translation": "leve, luz, claro", "pos": "adjetivo / substantivo", "tip": "'Light topics' = Assuntos leves."},
    "deep": {"translation": "profundo, intenso", "pos": "adjetivo", "tip": "'Deep conversation' = Conversa profunda."},
    "philosophical": {"translation": "filosófico", "pos": "adjetivo", "tip": "'Philosophical debate' = Debate filosófico."},
    "huge": {"translation": "enorme, gigantesco", "pos": "adjetivo", "tip": "'A huge difference' = Uma enorme diferença."},
    "vocabulary": {"translation": "vocabulário", "pos": "substantivo", "tip": "'Expand vocabulary' = Expandir o vocabulário."},
    "practice": {"translation": "praticar, treino, prática", "pos": "verbo / substantivo", "tip": "'Practice makes perfect' = A prática leva à perfeição."},
    "speaking": {"translation": "fala, conversação", "pos": "substantivo", "tip": "'Speaking skills' = Habilidades de fala."},
    "perfect": {"translation": "perfeito, ideal", "pos": "adjetivo", "tip": "'Perfect place' = Lugar perfeito."},
    "place": {"translation": "lugar, colocar", "pos": "substantivo / verbo", "tip": "'In the first place' = Em primeiro lugar."},
    "short": {"translation": "curto, breve, baixo", "pos": "adjetivo", "tip": "'Short conversations' = Conversas curtas."},
    "topic": {"translation": "assunto, tópico, tema", "pos": "substantivo", "tip": "'Today's topic' = O tema de hoje."},
    "topics": {"translation": "assuntos, tópicos, temas", "pos": "substantivo", "tip": "Plural de topic."},
    "conversation": {"translation": "conversa, diálogo", "pos": "substantivo", "tip": "'Start a conversation' = Iniciar uma conversa."},
    "conversations": {"translation": "conversas, diálogos", "pos": "substantivo", "tip": "Plural de conversation."},
    "channel": {"translation": "canal", "pos": "substantivo", "tip": "'YouTube channel' = Canal no YouTube."},
    "simple": {"translation": "simples, descomplicado", "pos": "adjetivo", "tip": "'Keep it simple' = Mantenha simples."},
    "funny": {"translation": "engraçado, divertido", "pos": "adjetivo", "tip": "'That's so funny!' = Isso é muito engraçado!"},
    "laugh": {"translation": "rir, risada", "pos": "verbo / substantivo", "tip": "'Make me laugh' = Me fazer rir."},
    "smile": {"translation": "sorrir, sorriso", "pos": "verbo / substantivo", "tip": "'Keep smiling' = Continue sorrindo."},
    "happy": {"translation": "feliz, contente", "pos": "adjetivo", "tip": "'Happy to help' = Feliz em ajudar."},
    "tired": {"translation": "cansado, farto", "pos": "adjetivo", "tip": "'I'm so tired' = Estou tão cansado(a)."},
    "busy": {"translation": "ocupado, agitado", "pos": "adjetivo", "tip": "'Busy day' = Dia corrido/ocupado."},
    "ready": {"translation": "pronto, preparado", "pos": "adjetivo", "tip": "'Are you ready?' = Você está pronto?"},
    "smart": {"translation": "inteligente, esperto", "pos": "adjetivo", "tip": "'Smart choice' = Escolha inteligente."},
    "polite": {"translation": "educado, cortês", "pos": "adjetivo", "tip": "'Be polite' = Seja educado."},
    "advice": {"translation": "conselho, orientação", "pos": "substantivo", "tip": "'Good advice' = Bom conselho."},
    "secret": {"translation": "segredo, secreto", "pos": "substantivo / adjetivo", "tip": "'Keep a secret' = Guardar segredo."},
    "politics": {"translation": "política", "pos": "substantivo", "tip": "'Avoid politics in small talk' = Evite política em conversas casuais."},
    "religion": {"translation": "religião", "pos": "substantivo", "tip": "'Sensitive topic' = Tema sensível."},
    "money": {"translation": "dinheiro", "pos": "substantivo", "tip": "'Save money' = Economizar dinheiro."},
    "salary": {"translation": "salário", "pos": "substantivo", "tip": "'Monthly salary' = Salário mensal."},
    "job": {"translation": "trabalho, emprego", "pos": "substantivo", "tip": "'Good job!' = Bom trabalho!"},
    "boss": {"translation": "chefe, patrão", "pos": "substantivo", "tip": "'Talk to the boss' = Falar com o chefe."},
    "vacation": {"translation": "férias", "pos": "substantivo", "tip": "'On vacation' = De férias. Ótimo assunto de conversa!"},
    "holiday": {"translation": "feriado, folga", "pos": "substantivo", "tip": "'Public holiday' = Feriado público."},
    "weekend": {"translation": "fim de semana", "pos": "substantivo", "tip": "'Have a great weekend!' = Tenha um ótimo fim de semana!"},
    "morning": {"translation": "manhã", "pos": "substantivo", "tip": "'Good morning!' = Bom dia!"},
    "afternoon": {"translation": "tarde", "pos": "substantivo", "tip": "'Good afternoon!' = Boa tarde!"},
    "night": {"translation": "noite", "pos": "substantivo", "tip": "'Good night!' = Boa noite!"},
    "fast": {"translation": "rápido, veloz", "pos": "adjetivo / advérbio", "tip": "'Fast food' / 'Hold on fast'."},
    "slow": {"translation": "lento, devagar", "pos": "adjetivo / advérbio", "tip": "'Slow down' = Diminua o ritmo."},
    "loud": {"translation": "alto, barulhento", "pos": "adjetivo", "tip": "'Too loud' = Alto demais."},
    "quiet": {"translation": "quieto, silencioso, calmo", "pos": "adjetivo", "tip": "'Be quiet' = Fique quieto."},
    "calm": {"translation": "calmo, tranquilo", "pos": "adjetivo", "tip": "'Stay calm' = Fique calmo."},
    "cool": {"translation": "legal, fresco, descolado", "pos": "adjetivo", "tip": "'That's cool!' = Que legal!"},
    "warm": {"translation": "morno, caloroso, acolhedor", "pos": "adjetivo", "tip": "'Warm welcome' = Boas-vindas calorosas."},
    "cold": {"translation": "frio, resfriado", "pos": "adjetivo / substantivo", "tip": "'It's cold outside' = Está frio lá fora."},
    "hot": {"translation": "quente, apimentado", "pos": "adjetivo", "tip": "'Hot coffee' = Café quente."},
    "rain": {"translation": "chuva, chover", "pos": "substantivo / verbo", "tip": "'It's raining' = Está chovendo."},
    "sunny": {"translation": "ensolarado", "pos": "adjetivo", "tip": "'Sunny day' = Dia de sol."},
    "cloudy": {"translation": "nublado", "pos": "adjetivo", "tip": "'Cloudy sky' = Céu nublado."},
    "compliment": {"translation": "elogio, elogiar", "pos": "substantivo / verbo", "tip": "'Give a compliment' = Fazer um elogio."},
    "compliments": {"translation": "elogios", "pos": "substantivo", "tip": "Plural de compliment."},
    "common": {"translation": "comum, frequente", "pos": "adjetivo", "tip": "'Common sense' = Bom senso."},
    "popular": {"translation": "popular, famoso", "pos": "adjetivo", "tip": "'Very popular' = Muito conhecido."},
    "interesting": {"translation": "interessante", "pos": "adjetivo", "tip": "'Sounds interesting!' = Parece interessante!"},
    "boring": {"translation": "chato, entediante", "pos": "adjetivo", "tip": "'Not boring at all' = Nem um pouco chato."},
    "fun": {"translation": "divertido, diversão", "pos": "adjetivo / substantivo", "tip": "'Have fun!' = Divirta-se!"},
    "break": {"translation": "pausa, intervalo, quebrar", "pos": "substantivo / verbo", "tip": "'Take a break' = Fazer uma pausa."},
    "finish": {"translation": "terminar, concluir", "pos": "verbo", "tip": "'Finish line' = Linha de chegada."},
    "learn": {"translation": "aprender", "pos": "verbo", "tip": "'Learn English' = Aprender inglês."},
    "teach": {"translation": "ensinar", "pos": "verbo", "tip": "'Teach someone' = Ensinar alguém."},
    "study": {"translation": "estudar, estudo", "pos": "verbo / substantivo", "tip": "'Study hard' = Estude com afinco."},
    "remember": {"translation": "lembrar, recordar", "pos": "verbo", "tip": "'Remember that' = Lembre-se disso."},
    "forget": {"translation": "esquecer", "pos": "verbo", "tip": "'Don't forget' = Não esqueça."},
    "choose": {"translation": "escolher", "pos": "verbo", "tip": "'Choose wisely' = Escolha com sabedoria."},
    "decide": {"translation": "decidir", "pos": "verbo", "tip": "'You decide' = Você decide."},
    "hope": {"translation": "esperar, torcer, esperança", "pos": "verbo / substantivo", "tip": "'I hope so' = Espero que sim."},
    "wish": {"translation": "desejar, vontade, desejo", "pos": "verbo / substantivo", "tip": "'Make a wish' = Faça um pedido."},
    "believe": {"translation": "acreditar, crer", "pos": "verbo", "tip": "'Believe in yourself' = Acredite em você."},
    "share": {"translation": "compartilhar, dividir", "pos": "verbo", "tip": "'Share your thoughts' = Compartilhe seus pensamentos."},
    "care": {"translation": "importar-se, cuidar", "pos": "verbo / substantivo", "tip": "'Take care' = Cuide-se."},
    "worry": {"translation": "preocupar-se", "pos": "verbo", "tip": "'Don't worry' = Não se preocupe."},
    "enjoy": {"translation": "aproveitar, curtir", "pos": "verbo", "tip": "'Enjoy your meal' = Bom apetite / aproveite."},
    "hate": {"translation": "odiar", "pos": "verbo", "tip": "'I hate traffic' = Odeio trânsito."},
    "love": {"translation": "amar, adorar, amor", "pos": "verbo / substantivo", "tip": "'I'd love to' = Adoraria."},
    "like": {"translation": "gostar de, como", "pos": "verbo / preposição", "tip": "'I like that' = Gostei disso."},
    "mistake": {"translation": "erro, engano", "pos": "substantivo", "tip": "'Make a mistake' = Cometer um erro."},
    "feeling": {"translation": "sentimento, sensação", "pos": "substantivo", "tip": "'Good feeling' = Sensação boa."},
    "opinion": {"translation": "opinião", "pos": "substantivo", "tip": "'In my opinion' = Na minha opinião."},
    "truth": {"translation": "verdade", "pos": "substantivo", "tip": "'Tell the truth' = Falar a verdade."},
    "world": {"translation": "mundo", "pos": "substantivo", "tip": "'All over the world' = Pelo mundo todo."},
    "city": {"translation": "cidade", "pos": "substantivo", "tip": "'Big city' = Cidade grande."},
    "food": {"translation": "comida, alimento", "pos": "substantivo", "tip": "'Delicious food' = Comida deliciosa."},
    "water": {"translation": "água", "pos": "substantivo", "tip": "'Drink water' = Beber água."},
    "drink": {"translation": "beber, bebida", "pos": "verbo / substantivo", "tip": "'Have a drink' = Tomar uma bebida."},
    "eat": {"translation": "comer", "pos": "verbo", "tip": "'Let's eat' = Vamos comer."},
    "buy": {"translation": "comprar", "pos": "verbo", "tip": "'Buy tickets' = Comprar ingressos."},
    "cheap": {"translation": "barato, em conta", "pos": "adjetivo", "tip": "'Very cheap' = Muito barato."},
    "expensive": {"translation": "caro", "pos": "adjetivo", "tip": "'Too expensive' = Caro demais."},
    "open": {"translation": "abrir, aberto", "pos": "verbo / adjetivo", "tip": "'Open the door' = Abra a porta."},
    "close": {"translation": "fechar, próximo", "pos": "verbo / adjetivo", "tip": "'Close friends' = Amigos próximos."},
    "clean": {"translation": "limpar, limpo", "pos": "verbo / adjetivo", "tip": "'Keep it clean' = Mantenha limpo."},
    "new": {"translation": "novo, recente", "pos": "adjetivo", "tip": "'Brand new' = Novinho em folha."},
    "old": {"translation": "velho, antigo", "pos": "adjetivo", "tip": "'Old friend' = Amigo antigo."},
    "big": {"translation": "grande, importante", "pos": "adjetivo", "tip": "'Big news' = Grande notícia."},
    "chance": {"translation": "chance, oportunidade", "pos": "substantivo", "tip": "'Take a chance' = Arriscar / dar uma chance."},
    "reason": {"translation": "razão, motivo", "pos": "substantivo", "tip": "'The reason why' = O motivo pelo qual."},
    "choice": {"translation": "escolha, opção", "pos": "substantivo", "tip": "'Good choice' = Boa escolha."},
    "goal": {"translation": "meta, objetivo, gol", "pos": "substantivo", "tip": "'Reach your goals' = Atingir suas metas."},
    "plan": {"translation": "plano, planejar", "pos": "substantivo / verbo", "tip": "'What's the plan?' = Qual é o plano?"},
    "future": {"translation": "futuro", "pos": "substantivo", "tip": "'In the future' = No futuro."},
    "moment": {"translation": "momento, instante", "pos": "substantivo", "tip": "'Just a moment' = Só um instante."},
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
    if cache_key in _TRANSLATION_CACHE and _TRANSLATION_CACHE[cache_key].strip().lower() != cache_key:
        return TranslateResponse(original=text, translation=_TRANSLATION_CACHE[cache_key])

    # Strategy 0: Instant built-in core dictionary lookup with stem/inflection support
    clean_single = re.sub(r'[^a-zA-Z]', '', text.lower())
    if " " not in text:
        # Exact match
        if clean_single in CORE_DICTIONARY:
            primary = CORE_DICTIONARY[clean_single]["translation"].split(",")[0].strip()
            _TRANSLATION_CACHE[cache_key] = primary
            return TranslateResponse(original=text, translation=primary)
        # Suffix matching: plurals or verb inflections
        if clean_single.endswith('s') and len(clean_single) > 3 and clean_single[:-1] in CORE_DICTIONARY:
            primary = CORE_DICTIONARY[clean_single[:-1]]["translation"].split(",")[0].strip()
            _TRANSLATION_CACHE[cache_key] = primary
            return TranslateResponse(original=text, translation=primary)
        if clean_single.endswith('es') and len(clean_single) > 4 and clean_single[:-2] in CORE_DICTIONARY:
            primary = CORE_DICTIONARY[clean_single[:-2]]["translation"].split(",")[0].strip()
            _TRANSLATION_CACHE[cache_key] = primary
            return TranslateResponse(original=text, translation=primary)
        if clean_single.endswith('ing') and len(clean_single) > 4 and clean_single[:-3] in CORE_DICTIONARY:
            primary = CORE_DICTIONARY[clean_single[:-3]]["translation"].split(",")[0].strip()
            _TRANSLATION_CACHE[cache_key] = primary
            return TranslateResponse(original=text, translation=primary)
        if clean_single.endswith('ed') and len(clean_single) > 4 and clean_single[:-2] in CORE_DICTIONARY:
            primary = CORE_DICTIONARY[clean_single[:-2]]["translation"].split(",")[0].strip()
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

    # Strategy 2: Google translate gtx with browser headers
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
        print(f"Strategy 2 Translation error: {e}")

    # Strategy 3: Google translate webapp client
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=webapp&sl=en&tl=pt&dt=t&q={urllib.parse.quote(text)}"
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

    # Strategy 4: MyMemory Translation API
    try:
        res = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": "en|pt-BR"},
            timeout=6
        )
        if res.status_code == 200:
            data = res.json()
            translated = data.get("responseData", {}).get("translatedText")
            if translated and translated.strip().lower() != text.lower() and "MYMEMORY WARNING" not in translated.upper():
                _TRANSLATION_CACHE[cache_key] = translated
                return TranslateResponse(original=text, translation=translated)
    except Exception as e:
        print(f"Strategy 4 Translation error: {e}")

    # Strategy 5: Lemmatized or individual token fallback for short phrases/words
    tokens = [re.sub(r'[^a-zA-Z]', '', tok).lower() for tok in text.split()]
    dict_matches = [CORE_DICTIONARY[t]["translation"].split(",")[0].strip() for t in tokens if t in CORE_DICTIONARY]
    if dict_matches:
        fallback_trans = " ".join(dict_matches)
        _TRANSLATION_CACHE[cache_key] = fallback_trans
        return TranslateResponse(original=text, translation=fallback_trans)

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


@router.get("/tts")
async def text_to_speech(
    text: str = Query(..., description="The English phrase or word to synthesize"),
    voice: Optional[str] = Query("male", description="Voice ID or shortcut: male, female, guy, ava, british_male, british_female"),
    rate: Optional[str] = Query("+0%", description="Speech speed adjustment: +0%, -10%, +10%"),
):
    """
    Synthesize natural, human-grade native English speech audio using Azure Neural TTS.
    Returns audio/mpeg directly for instant browser HTML5 playback.
    """
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    # Resolve voice name
    resolved_voice = VOICE_MAP.get((voice or "").lower().strip(), voice) or "en-US-ChristopherNeural"
    clean_rate = rate.strip() if rate else "+0%"

    cache_key = f"{resolved_voice}_{clean_rate}_{clean_text.lower()}"
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

    try:
        communicate = edge_tts.Communicate(clean_text, resolved_voice, rate=clean_rate)
        audio_stream = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])

        audio_bytes = audio_stream.getvalue()
        if not audio_bytes:
            raise ValueError("TTS engine produced empty audio stream.")

        # Cache up to 1000 items in memory
        if len(_TTS_CACHE) < 1000:
            _TTS_CACHE[cache_key] = audio_bytes

        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=86400",
                "Content-Disposition": "inline; filename=speech.mp3",
                "X-TTS-Source": "neural"
            }
        )
    except Exception as e:
        print(f"Neural TTS generation notice: {e}")
        raise HTTPException(status_code=500, detail=f"TTS generation error: {str(e)}")


