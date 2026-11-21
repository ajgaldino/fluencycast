import hashlib
from typing import List

from app.core.config import settings

WORD_LENGTH = 5
MAX_GUESSES = 6

WORDS = """
about above actor adult after again agree ahead alarm album alive allow alone along angry apple argue arise
awake beach begin below black blood brain bread break bring brown build carry catch cause chair cheap check
child clean clear climb clock close cloud coach count cover crazy cream cross crowd dance death doubt dream
dress drink drive early earth empty enjoy enter equal event every exact field final floor focus force frame
fresh front fruit funny ghost giant glass globe grace grand grass great green group guess guide happy heart
heavy horse hotel house human ideal image inner issue jeans joint judge juice knife laugh learn leave light
limit local lucky lunch magic major match maybe mayor media metal money month moral mouse music night noise
north novel nurse ocean offer order other paint paper party peace phone photo piano pilot place plain plane
plant point power press price pride prize proof proud queen quick quiet radio raise range reach ready right
river round royal rural salad scale scene score sense shape share sharp sheep shine shirt shock short sight
sleep small smart smile smoke solid sound south space speak speed spend sport staff stage start state steal
steel stone store storm story sugar sweet table taste teach thank their there thing think three throw tiger
title today touch tower track trade train treat trial trust truth twice uncle union unity until upper urban
usual value video visit voice waste watch water wheel where which while white whole whose woman world worry
worth write wrong young youth
""".split()


def target_word(day: str) -> str:
    digest = hashlib.sha256(f"{day}:{settings.SECRET_KEY}".encode()).hexdigest()
    return WORDS[int(digest[:12], 16) % len(WORDS)]


def evaluate(guess: str, target: str) -> List[str]:
    """Standard Wordle scoring: 'correct', 'present' or 'absent' per letter."""
    result = ["absent"] * len(guess)
    remaining = {}
    for i, ch in enumerate(target):
        if guess[i] == ch:
            result[i] = "correct"
        else:
            remaining[ch] = remaining.get(ch, 0) + 1
    for i, ch in enumerate(guess):
        if result[i] == "correct":
            continue
        if remaining.get(ch, 0) > 0:
            result[i] = "present"
            remaining[ch] -= 1
    return result


def xp_for_result(won: bool, attempts: int) -> int:
    if not won:
        return 3
    return max(10, 40 - 5 * (attempts - 1))
