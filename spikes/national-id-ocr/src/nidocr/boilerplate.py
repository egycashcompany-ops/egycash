"""The words printed on every card, which belong to nobody.

An Egyptian ID carries two kinds of text. One kind is the holder's — their name, their address,
their occupation. The other is furniture: the republic's name across the top of the front, the
title of the document, the labels beside the fields on the back. Furniture is identical on every
card ever issued, and it is the reason a field crop that is slightly too generous produces a value
that is wrong rather than merely rough:

    بطاقة تحقيق الشخصية ندى محمد رضوان

is not a name, and no reviewer glancing down a filled form will read it as a mistake — it looks
like the OCR did something, so it gets waved through.

Handling it here rather than by tightening the boxes is the point. Geometry has been tuned three
times against real cards and missed something each time, because a box tight enough to exclude the
header is also tight enough to clip the first line of a long name — and clipping is the worse
failure, since a missing word cannot be recovered downstream while a known phrase can simply be
removed. So the boxes get to be generous and this module cleans up after them.

Matching is on whole TOKEN SEQUENCES of the rasm-folded text, never on single loose words, and that
restriction is load-bearing. 'مصر' on its own is a district in Cairo (مصر الجديدة, مصر القديمة) and
appears in real addresses; 'جمهورية مصر العربية' is the state's name and appears in nobody's. A
phrase of two or more tokens cannot collide with personal data the way a bare word can.
"""

from __future__ import annotations

import re

from .arabic import rasm_fold

#: Printed on the front of every card.
FRONT_BOILERPLATE: tuple[str, ...] = (
    "جمهورية مصر العربية",
    "بطاقة تحقيق الشخصية",
    "بطاقة تحقيق شخصية",
    "وزارة الداخلية",
    "مصلحة الأحوال المدنية",
)

#: Printed on the back: the field labels, the issuing-office row and the validity row. Each is
#: followed on the card by the value it labels, so removing the label leaves the value behind —
#: which is exactly what a crop that caught both should end up with.
BACK_BOILERPLATE: tuple[str, ...] = (
    "الرقم القومي",
    "البطاقة سارية حتى",
    "سارية حتى",
    "جهة الإصدار",
    "تاريخ الإصدار",
    "الحالة الاجتماعية",
    "الديانة",
    "الوظيفة",
)

PHRASES: tuple[str, ...] = tuple(dict.fromkeys(FRONT_BOILERPLATE + BACK_BOILERPLATE))

#: Punctuation a recognizer glues onto a word. Trimmed before comparison so a stray dash does not
#: make a phrase stop matching — the same reasoning as folding the dots away.
_EDGES = "-–—:.,،؛()[]"


def _key(token: str) -> str:
    return rasm_fold(token).strip(_EDGES)


def _folded(phrase: str) -> tuple[str, ...]:
    return tuple(key for key in (_key(token) for token in phrase.split()) if key)


# Longest first, so 'البطاقة سارية حتى' is consumed whole rather than leaving 'البطاقة' behind after
# the shorter 'سارية حتى' matched inside it.
_SEQUENCES: tuple[tuple[str, ...], ...] = tuple(
    sorted((_folded(phrase) for phrase in PHRASES), key=len, reverse=True)
)

#: A token that is only digits (in either script) once folded. Kept when deciding whether a line is
#: *entirely* furniture, because the label rows on the back carry the value being labelled.
_DIGITS = re.compile(r"^[0-9٠-٩۰-۹/\-.]+$")


def strip_boilerplate(text: str) -> str:
    """Remove any printed card furniture from a value, leaving the holder's own text.

    Whole token runs only. A partial match — the phrase's first two words appearing at the end of a
    line — is left alone, because a partial match is far more likely to be a coincidence in real
    text than a truncated header.
    """
    tokens = text.split()
    if not tokens:
        return text

    keys = [_key(token) for token in tokens]
    keep = [True] * len(tokens)
    for sequence in _SEQUENCES:
        span = len(sequence)
        if span == 0 or span > len(tokens):
            continue
        for start in range(len(tokens) - span + 1):
            window = keys[start : start + span]
            if tuple(window) == sequence and all(keep[start : start + span]):
                for index in range(start, start + span):
                    keep[index] = False

    return " ".join(token for token, wanted in zip(tokens, keep) if wanted).strip()


def is_boilerplate(text: str) -> bool:
    """Is this whole line card furniture and nothing else?

    Used to drop a line from anchoring altogether. The distinction from `strip_boilerplate` matters:
    `البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤` is a label AND the expiry date, so the line must survive — it is
    how the expiry is found. `بطاقة تحقيق الشخصية` is a label and nothing else, so the line carries
    no field and must never be allowed to pull a field box upward onto itself.
    """
    remaining = strip_boilerplate(text)
    if not remaining.strip():
        return True
    # A label plus a value is not furniture; a label plus a stray mark is.
    return all(len(token) <= 1 and not _DIGITS.match(token) for token in remaining.split())
