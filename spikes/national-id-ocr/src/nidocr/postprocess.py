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
from .boilerplate import strip_boilerplate
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
        recovered = _date_without_separators(text)
        if recovered is not None:
            return recovered, True
        # One separator read and the other dropped: '202612/25'. Only digits and separators, so
        # dropping the separators leaves exactly what was printed, and it must still be a date.
        for run in re.findall(r"[\d/\-.]{8,}", text):
            date = _yyyymmdd(re.sub(r"\D", "", run))
            if date is not None:
                return date, True
        return collapse_spaces(text), False
    year, month, day = (int(part) for part in match.groups())
    try:
        return _dt.date(year, month, day).isoformat(), True
    except ValueError:
        return collapse_spaces(text), False


#: Glyphs the Arabic recognizer emits in place of the printed '/'. A slash is one thin diagonal
#: stroke, and so are ١ and ٧ — the real model read ٢٠٢٩/٠٥/١١ as 202910511.
_SLASH_LOOKALIKES = frozenset("17")


def _date_without_separators(text: str) -> str | None:
    """A date whose slashes were dropped or misread. → ISO date, or None if not unambiguous.

    The first real-model run returned 0 of 8 expiries as dates, and not one was a digit misread:
    the recognizer either dropped both slashes ('20321016') or read one as ١/٧ ('202910511'). The
    date was all there. Accepted only when exactly one interpretation is a valid date, so an
    ambiguous read stays text for the reviewer rather than becoming a confident wrong date.
    """
    for run in re.findall(r"\d{8,10}", re.sub(r"\s+", "", text)):
        candidates = {run}
        # Drop up to two slash look-alikes, each where a separator is printed: right after the
        # year, and right after a one- or two-digit month.
        if run[4] in _SLASH_LOOKALIKES:
            once = run[:4] + run[5:]
            candidates.add(once)
            for second in (5, 6):
                if len(once) > second and once[second] in _SLASH_LOOKALIKES:
                    candidates.add(once[:second] + once[second + 1 :])
        for second in (6, 7):
            if len(run) > second and run[second] in _SLASH_LOOKALIKES:
                candidates.add(run[:second] + run[second + 1 :])

        dates = {date for candidate in candidates if (date := _yyyymmdd(candidate)) is not None}
        if len(dates) == 1:
            return dates.pop()
    return None


def _yyyymmdd(digits: str) -> str | None:
    if len(digits) != 8:
        return None
    year, month, day = int(digits[:4]), int(digits[4:6]), int(digits[6:])
    if not 2000 <= year <= 2100:
        return None
    try:
        return _dt.date(year, month, day).isoformat()
    except ValueError:
        return None


# Closed vocabularies. Keys are the normalized (folded) forms so that orthographic variation in
# the OCR output — which is the common case for Arabic — still matches.
RELIGION_TERMS = ("مسلم", "مسلمة", "مسيحي", "مسيحية")
MARITAL_TERMS = ("أعزب", "عزباء", "متزوج", "متزوجة", "مطلق", "مطلقة", "أرمل", "أرملة")

_RELIGIONS = {normalize_arabic(term): term for term in RELIGION_TERMS}
_MARITAL = {normalize_arabic(term): term for term in MARITAL_TERMS}

# Rasm indexes for the dot-tolerant pass. Built defensively: if two terms in a vocabulary ever
# folded to the same skeleton, snapping between them would become a silent coin flip, so a
# collision drops BOTH from the index rather than letting one shadow the other. Neither vocabulary
# collides today — this exists so that adding a term later cannot quietly introduce one.
def _rasm_index(terms: tuple[str, ...]) -> dict[str, str]:
    grouped: dict[str, list[str]] = {}
    for term in terms:
        grouped.setdefault(rasm_fold(term), []).append(term)
    return {folded: found[0] for folded, found in grouped.items() if len(found) == 1}


_RELIGIONS_RASM = _rasm_index(RELIGION_TERMS)
_MARITAL_RASM = _rasm_index(MARITAL_TERMS)


def _snap(
    raw: str,
    vocabulary: dict[str, str],
    rasm_index: dict[str, str],
    terms: tuple[str, ...] = (),
) -> tuple[str, bool]:
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
        # A clean-looking hit can still be the wrong gender: a dropped ة turns متزوجة into متزوج,
        # which is itself a vocabulary term and snaps silently. The sex on the same row corrects it.
        return _agree_in_gender(text, hits[0], terms) or hits[0], True
    if len(hits) == 2 and _COUNTERPART.get(hits[0]) == hits[1]:
        # The word matched both its own spelling and its counterpart, which is what the whole
        # sex/religion/marital row does: مسلم is a substring of مسلمة. The row states the sex, so
        # take whichever of the two agrees with it.
        feminine_line = _line_is_feminine(text)
        if feminine_line is not None:
            agreeing = [term for term in hits if (term in _IS_FEMININE) == feminine_line]
            if len(agreeing) == 1:
                return agreeing[0], True

    folded_key = rasm_fold(text)
    if folded_key in rasm_index:
        return rasm_index[folded_key], True
    hits = [term for folded, term in rasm_index.items() if folded in folded_key or folded_key in folded]
    if len(hits) == 1:
        return hits[0], True
    return text, False


#: The sex words, folded. Read to settle a masculine/feminine tie and for nothing else.
_FEMININE = frozenset({rasm_fold("أنثى"), rasm_fold("انثى"), rasm_fold("أنثي"), rasm_fold("انثي")})
_MASCULINE = frozenset({rasm_fold("ذكر")})


#: (masculine, feminine) for every term that has both. Listed rather than derived, because the
#: relationship is not a suffix rule: متزوج/متزوجة adds a ة, but أعزب/عزباء changes the word. Six
#: pairs is a table, and a table cannot be wrong about Arabic morphology the way a rule can.
_GENDER_PAIRS: tuple[tuple[str, str], ...] = (
    ("مسلم", "مسلمة"),
    ("مسيحي", "مسيحية"),
    ("أعزب", "عزباء"),
    ("متزوج", "متزوجة"),
    ("مطلق", "مطلقة"),
    ("أرمل", "أرملة"),
)
_COUNTERPART = {
    **{masculine: feminine for masculine, feminine in _GENDER_PAIRS},
    **{feminine: masculine for masculine, feminine in _GENDER_PAIRS},
}
_IS_FEMININE = {feminine for _, feminine in _GENDER_PAIRS}


def _line_is_feminine(raw: str) -> bool | None:
    """Which sex the row states, or None when it states neither."""
    folded = rasm_fold(raw)
    feminine = any(word in folded for word in _FEMININE)
    masculine = any(word in folded for word in _MASCULINE)
    return None if feminine == masculine else feminine


def _agree_in_gender(raw: str, matched: str, terms: tuple[str, ...]) -> str | None:
    """Correct a term to the gender the same printed line states, when it disagrees.

    The card puts sex, religion and marital status on ONE row — `أنثى مسلمة متزوجة` — and Arabic
    makes the last two agree with the first. The feminine marker is a single trailing ة, which is
    also the first thing a recognizer drops, and dropping it turns متزوجة into متزوج: still a real
    vocabulary term, so it snaps cleanly and silently records the wrong marital status. Nothing
    downstream can tell, because the value looks entirely reasonable.

    The row itself resolves it. If the line says أنثى and the matched term is masculine while its
    feminine counterpart exists in the vocabulary, the counterpart is what was printed.

    This is NOT a second source for gender and never reaches the output: it corrects the spelling
    of a DIFFERENT field. `parseNationalId` remains the only thing that says whether a person is
    male or female, and nothing here is returned as a sex.

    Silent unless every part of the justification is present — a sex word on the line, a genuine
    disagreement, and exactly one counterpart in the vocabulary. Anywhere else the evidence for
    changing a value the model actually read does not exist.
    """
    feminine_line = _line_is_feminine(raw)
    if feminine_line is None:
        return None  # the row states no sex; there is nothing to agree with
    if (matched in _IS_FEMININE) == feminine_line:
        return None  # already agrees; nothing to correct

    counterpart = _COUNTERPART.get(matched)
    return counterpart if counterpart in terms else None


def clean_religion(raw: str) -> tuple[str, bool]:
    return _snap(raw, _RELIGIONS, _RELIGIONS_RASM, RELIGION_TERMS)


def clean_marital_status(raw: str) -> tuple[str, bool]:
    return _snap(raw, _MARITAL, _MARITAL_RASM, MARITAL_TERMS)


def clean_text(raw: str) -> str:
    """Free Arabic text (name, occupation): whitespace, and the card's own printed words.

    Deliberately does NOT apply `normalize_arabic`. That fold is for comparison; applying it to a
    stored value would strip the hamzas and taa marbuta out of a person's actual name.

    Card furniture IS removed. 'بطاقة تحقيق الشخصية' is printed directly above the name on every
    Egyptian card, so a name box generous enough not to clip a long name can catch it — and the
    trade is not symmetric. A header glued onto a name is recoverable here, because the phrase is
    identical on every card ever issued; a name whose first line was cropped away is not recoverable
    anywhere. So the boxes are allowed to be generous and this removes what that lets in.
    """
    return collapse_spaces(strip_boilerplate(collapse_spaces(raw)))


def clean_address(raw: str) -> tuple[str, bool]:
    """Address text, with the governorate at the end repaired against the official list.

    Only the tail is corrected, because only the tail comes from a closed set. Building numbers,
    street names and districts are free text with nothing to check them against, and rewriting any
    of that would be invention rather than correction — see `governorates.snap_address_tail`.

    Printed card furniture is removed first, for the same reason as in `clean_text`: the governorate
    is matched against the END of the address, so a stray printed word left on the tail would stop
    the match that repairs it.
    """
    return snap_address_tail(
        collapse_spaces(strip_boilerplate(collapse_spaces(_space_numbers(raw))))
    )


#: A number run straight into a word, or a word into a number, in either digit set.
_NUMBER_WORD = re.compile(r"(?<=[0-9٠-٩])(?=[ء-ي])|(?<=[ء-ي])(?=[0-9٠-٩])")


def _space_numbers(text: str) -> str:
    """'٣٥٥زهراء' → '٣٥٥ زهراء'. A soft photo closes the gap after a house number; the card always
    prints one, and no Arabic address word begins or ends with a digit."""
    return _NUMBER_WORD.sub(" ", text)
