"""Per-field cleanup and confidence banding.

Two ideas carry this module.

**Field-typed cleanup.** A recognizer returns a string; what makes it a *value* is knowing which
field it belongs to. The national ID is digits only, so anything else is noise to strip. The
expiry is a date in a known printed form. Religion and marital status are drawn from a tiny closed
vocabulary, so a near-miss can be snapped to the intended term — but only when the match is
unambiguous, because silently "correcting" a field a human will not re-read is worse than leaving
it visibly rough.

**Structure beats self-reported confidence.** A recognizer's score says how sure the model is
about its own pixels, which is not the same as whether the answer can be true. A 14-digit string
with an impossible birth month is wrong at score 0.99. So `band()` lets a structural check
override the model downward — never upward. The result feeds `OcrFieldDto.confidence`, which is
what tells the human reviewer where to look.
"""

from __future__ import annotations

import datetime as _dt
import re

from .arabic import collapse_spaces, normalize_arabic, to_western_digits
from .nid import is_structurally_valid, salvage_digits

Band = str  # 'high' | 'medium' | 'low' — mirrors OcrFieldDto.confidence

# Thresholds are starting points, to be re-tuned once real fixtures produce a score distribution.
# Deliberately conservative: over-reporting confidence is the failure mode that actually hurts,
# because it is the one that stops a reviewer from looking.
_HIGH = 0.90
_MEDIUM = 0.70


def band(score: float, *, structurally_valid: bool | None = None) -> Band:
    """Map a model score to a confidence band, with an optional structural veto."""
    if structurally_valid is False:
        return "low"  # cannot be true, whatever the model thinks
    if score >= _HIGH:
        return "high"
    if score >= _MEDIUM:
        return "medium"
    return "low"


def clean_national_id(raw: str) -> tuple[str, bool]:
    """→ (digits, structurally_valid). Folds Indic numerals and drops separators."""
    digits = salvage_digits(raw)
    return digits, is_structurally_valid(digits)


# The card prints the expiry as YYYY/MM/DD in Indic numerals. Accept the common separators a
# recognizer might substitute, but require the full shape — a partial date is not a date.
_DATE = re.compile(r"(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})")


def clean_expiry(raw: str) -> tuple[str, bool]:
    """→ (ISO date or cleaned text, parsed_ok).

    Returns ISO-8601 on success so the value crosses into TypeScript unambiguously; on failure it
    returns the cleaned text rather than nothing, because a human reviewing a rough date beats a
    human retyping a blank field.
    """
    text = to_western_digits(raw)
    match = _DATE.search(text)
    if match is None:
        return collapse_spaces(text), False
    year, month, day = (int(part) for part in match.groups())
    try:
        return _dt.date(year, month, day).isoformat(), True
    except ValueError:
        return collapse_spaces(text), False


# Closed vocabularies. Keys are the normalized (folded) forms so that orthographic variation in
# the OCR output — which is the common case for Arabic — still matches.
_RELIGIONS = {normalize_arabic(term): term for term in ("مسلم", "مسلمة", "مسيحي", "مسيحية")}
_MARITAL = {
    normalize_arabic(term): term
    for term in ("أعزب", "عزباء", "متزوج", "متزوجة", "مطلق", "مطلقة", "أرمل", "أرملة")
}


def _snap(raw: str, vocabulary: dict[str, str]) -> tuple[str, bool]:
    """Snap to a vocabulary term when unambiguous; otherwise return the text unchanged.

    Substring matching in both directions catches the two realistic OCR errors: a dropped final
    letter, and a stray character glued on. Anything matching more than one term is left alone —
    an ambiguous snap would manufacture certainty the pixels do not support.
    """
    text = collapse_spaces(raw)
    key = normalize_arabic(text)
    if not key:
        return text, False
    if key in vocabulary:
        return vocabulary[key], True
    hits = [term for folded, term in vocabulary.items() if folded in key or key in folded]
    if len(hits) == 1:
        return hits[0], True
    return text, False


def clean_religion(raw: str) -> tuple[str, bool]:
    return _snap(raw, _RELIGIONS)


def clean_marital_status(raw: str) -> tuple[str, bool]:
    return _snap(raw, _MARITAL)


def clean_text(raw: str) -> str:
    """Free Arabic text (name, address, occupation): whitespace only.

    Deliberately does NOT apply `normalize_arabic`. That fold is for comparison; applying it to a
    stored value would strip the hamzas and taa marbuta out of a person's actual name.
    """
    return collapse_spaces(raw)
