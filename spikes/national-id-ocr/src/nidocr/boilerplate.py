"""The words printed on every card, which belong to nobody."""

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

#: Printed on the back: the field labels, the issuing-office row and the validity row.
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
#: make a phrase stop matching, the same reasoning as folding the dots away.
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
    """Remove any printed card furniture from a value, leaving the holder's own text."""
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
    """Is this whole line card furniture and nothing else?"""
    remaining = strip_boilerplate(text)
    if not remaining.strip():
        return True
    # A label plus a value is not furniture; a label plus a stray mark is.
    return all(len(token) <= 1 and not _DIGITS.match(token) for token in remaining.split())
