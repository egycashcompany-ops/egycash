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

from .arabic import collapse_spaces, normalize_arabic, rasm_fold, to_western_digits
from .governorates import snap_address_tail
from .nid import repair as repair_national_id

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


_RANK = {"low": 0, "medium": 1, "high": 2}


def cap(value: Band, ceiling: Band) -> Band:
    """Lower a band to at most `ceiling`, never raise it.

    Used wherever a value was arrived at partly by inference rather than purely by reading the
    pixels — a repaired national ID, a number chosen because the other side's was invalid. Those
    are worth keeping and worth flagging, and the way to flag them is to refuse the top band: a
    reviewer's attention is drawn by anything that is not 'high', which is exactly where it should
    go on a field the pipeline had to reason its way to.
    """
    return value if _RANK[value] <= _RANK[ceiling] else ceiling


def clean_national_id(raw: str):
    """→ a `nid.Repair`. Folds Indic numerals, drops separators, and repairs where the structure
    identifies a unique correction.

    Returns the whole repair record rather than a value and a flag, because the caller needs to
    distinguish three outcomes that a boolean cannot: read cleanly, corrected (so confidence is
    capped — a structural deduction is not the model having read the digits), and ambiguous (so
    confidence is floored — several different people's numbers were equally close to this read).
    """
    return repair_national_id(raw)


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
_RELIGION_TERMS = ("مسلم", "مسلمة", "مسيحي", "مسيحية")
_MARITAL_TERMS = ("أعزب", "عزباء", "متزوج", "متزوجة", "مطلق", "مطلقة", "أرمل", "أرملة")

_RELIGIONS = {normalize_arabic(term): term for term in _RELIGION_TERMS}
_MARITAL = {normalize_arabic(term): term for term in _MARITAL_TERMS}

# Rasm indexes for the dot-tolerant pass. Built defensively: if two terms in a vocabulary ever
# folded to the same skeleton, snapping between them would become a silent coin flip, so a
# collision drops BOTH from the index rather than letting one shadow the other. Neither vocabulary
# collides today — this exists so that adding a term later cannot quietly introduce one.
def _rasm_index(terms: tuple[str, ...]) -> dict[str, str]:
    grouped: dict[str, list[str]] = {}
    for term in terms:
        grouped.setdefault(rasm_fold(term), []).append(term)
    return {folded: found[0] for folded, found in grouped.items() if len(found) == 1}


_RELIGIONS_RASM = _rasm_index(_RELIGION_TERMS)
_MARITAL_RASM = _rasm_index(_MARITAL_TERMS)


def _snap(raw: str, vocabulary: dict[str, str], rasm_index: dict[str, str]) -> tuple[str, bool]:
    """Snap to a vocabulary term when unambiguous; otherwise return the text unchanged.

    Three passes. Exact after the standard fold; then substring matching in both directions, which
    catches a dropped final letter or a stray character glued on; then exact after RASM folding,
    which forgives the dots — and dots are what a recognizer loses first, being the smallest marks
    on the card and the first thing a reflection erases. A read of مسلمه where مسلمة was printed
    has got the letterforms exactly right and one dot wrong, and it should not cost the reviewer a
    retype.

    There is deliberately NO edit-distance pass. In both of these vocabularies the masculine and
    feminine forms differ by exactly one character — مسلم/مسلمة, متزوج/متزوجة, أرمل/أرملة — so a
    distance-1 match is ambiguous between them by construction, and the ambiguity guard would
    reject it anyway. Worse, that one character is not noise: it is the part of the value carrying
    the meaning. Rasm folding is safe here precisely because it maps ة onto ه rather than deleting
    it, so the feminine ending survives the fold and the two forms stay distinct.

    Anything matching more than one term is left alone. An ambiguous snap manufactures certainty
    the pixels do not support, and a reviewer does not re-read a field that looks decided.
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

    folded_key = rasm_fold(text)
    if folded_key in rasm_index:
        return rasm_index[folded_key], True
    hits = [term for folded, term in rasm_index.items() if folded in folded_key or folded_key in folded]
    if len(hits) == 1:
        return hits[0], True
    return text, False


def clean_religion(raw: str) -> tuple[str, bool]:
    return _snap(raw, _RELIGIONS, _RELIGIONS_RASM)


def clean_marital_status(raw: str) -> tuple[str, bool]:
    return _snap(raw, _MARITAL, _MARITAL_RASM)


def clean_text(raw: str) -> str:
    """Free Arabic text (name, occupation): whitespace only.

    Deliberately does NOT apply `normalize_arabic`. That fold is for comparison; applying it to a
    stored value would strip the hamzas and taa marbuta out of a person's actual name.
    """
    return collapse_spaces(raw)


def clean_address(raw: str) -> tuple[str, bool]:
    """Address text, with the governorate at the end repaired against the official list.

    Only the tail is corrected, because only the tail comes from a closed set. Building numbers,
    street names and districts are free text with nothing to check them against, and rewriting any
    of that would be invention rather than correction — see `governorates.snap_address_tail`.
    """
    return snap_address_tail(collapse_spaces(raw))
