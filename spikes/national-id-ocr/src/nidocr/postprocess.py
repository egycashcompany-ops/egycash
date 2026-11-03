"""Per-field cleanup and confidence banding."""

from __future__ import annotations

import datetime as _dt
import re

from .arabic import collapse_spaces, normalize_arabic, rasm_fold, to_western_digits
from .boilerplate import strip_boilerplate
from .governorates import snap_address_tail
from .nid import repair as repair_national_id

Band = str  # 'high' | 'medium' | 'low', mirrors OcrFieldDto.confidence

# Thresholds are starting points, to be re-tuned once real fixtures produce a score distribution.
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
    """Lower a band to at most `ceiling`, never raise it."""
    return value if _RANK[value] <= _RANK[ceiling] else ceiling


def clean_national_id(raw: str):
    """→ a `nid.Repair`. Folds Indic numerals, drops separators, and repairs where the structure
    identifies a unique correction.
    """
    return repair_national_id(raw)


# The card prints the expiry as YYYY/MM/DD in Indic numerals. Accept the common separators a
# recognizer might substitute, but require the full shape, a partial date is not a date.
_DATE = re.compile(r"(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})")


def clean_expiry(raw: str) -> tuple[str, bool]:
    """→ (ISO date or cleaned text, parsed_ok)."""
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
#: stroke, and so are ١ and ٧, the real model read ٢٠٢٩/٠٥/١١ as 202910511.
_SLASH_LOOKALIKES = frozenset("17")


def _date_without_separators(text: str) -> str | None:
    """A date whose slashes were dropped or misread. → ISO date, or None if not unambiguous."""
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
# the OCR output, which is the common case for Arabic, still matches.
RELIGION_TERMS = ("مسلم", "مسلمة", "مسيحي", "مسيحية")
#: 'آنسة' is what a card prints for an unmarried woman (a man's says 'أعزب'); the form takes both
#: as single.
MARITAL_TERMS = ("أعزب", "عزباء", "متزوج", "متزوجة", "مطلق", "مطلقة", "أرمل", "أرملة", "آنسة")

_RELIGIONS = {normalize_arabic(term): term for term in RELIGION_TERMS}
_MARITAL = {normalize_arabic(term): term for term in MARITAL_TERMS}

# Rasm indexes for the dot-tolerant pass.
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
    """Snap to a vocabulary term when unambiguous; otherwise return the text unchanged."""
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
        # sex/religion/marital row does: مسلم is a substring of مسلمة.
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


#: (masculine, feminine) for every term that has both.
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

#: Fields whose words have a masculine and a feminine form.
GENDERED_FIELDS = ("religion", "maritalStatus")


def agree_with_sex(fields: dict[str, dict], female: bool | None) -> None:
    """Put religion and marital status in the holder's grammatical gender.

    The two forms differ by one letter (متزوج / متزوجة), which the recognizer drops often enough that a
    woman's card was coming back with the masculine word. When the holder's sex is known (see
    extract._holder_is_female), a word in the other form is swapped for its counterpart and held at
    'medium' at most, so a person confirms it. Unknown sex changes nothing.
    """
    if female is None:
        return
    for name in GENDERED_FIELDS:
        data = fields.get(name)
        if not data or data.get("value") not in _COUNTERPART:
            continue
        if (data["value"] in _IS_FEMININE) == female:
            continue
        data["value"] = _COUNTERPART[data["value"]]
        data["confidence"] = "low" if data.get("confidence") == "low" else "medium"
        data["genderCorrected"] = True


def _line_is_feminine(raw: str) -> bool | None:
    """Which sex the row states, or None when it states neither."""
    folded = rasm_fold(raw)
    feminine = any(word in folded for word in _FEMININE)
    masculine = any(word in folded for word in _MASCULINE)
    return None if feminine == masculine else feminine


def _agree_in_gender(raw: str, matched: str, terms: tuple[str, ...]) -> str | None:
    """Correct a term to the gender the same printed line states, when it disagrees."""
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
    """Free Arabic text (name, occupation): whitespace, and the card's own printed words."""
    return collapse_spaces(strip_boilerplate(collapse_spaces(raw)))


def clean_address(raw: str) -> tuple[str, bool]:
    """Address text, with the governorate at the end repaired against the official list."""
    return snap_address_tail(
        _unglue(
            _drop_fragments(
                collapse_spaces(strip_boilerplate(collapse_spaces(_space_numbers(_indic_digits(raw)))))
            )
        )
    )


#: Address words that a lost hyphen or space glues to their neighbour: 'البراهمه-نجع' read as
#: 'البراهمهنجع'. Only words no place name contains as part of itself.
_GLUEABLE = ("نجع", "عزبة", "عزبه", "شارع", "مركز", "قرية", "قريه", "منشاة", "شياخة")


def _unglue(text: str) -> str:
    """Put back the space between a place name and an address word glued onto it."""
    words = []
    for word in text.split():
        for marker in _GLUEABLE:
            if word.endswith(marker) and len(word) - len(marker) >= 3:
                word = word[: -len(marker)] + " " + marker
                break
            if word.startswith(marker) and len(word) - len(marker) >= 3 and marker != "شارع":
                word = marker + " " + word[len(marker):]
                break
        words.append(word)
    return " ".join(words)


#: One-letter words an Egyptian address really prints: ش for شارع, and و.
_REAL_ONE_LETTER = {"ش", "و"}


def _drop_fragments(text: str) -> str:
    """Remove the broken pieces a line read twice leaves behind."""
    words = text.split()
    kept = []
    for index, word in enumerate(words):
        before = words[index - 1] if index else ""
        after = words[index + 1] if index + 1 < len(words) else ""
        if word.endswith("ـ"):
            continue
        if (
            len(word) == 1
            and "ء" <= word <= "ي"
            and word not in _REAL_ONE_LETTER
            and (after.startswith(word) or before.endswith(word))
        ):
            continue
        kept.append(word)
    return " ".join(kept)


#: A number run straight into a word, or a word into a number, in either digit set.
_NUMBER_WORD = re.compile(r"(?<=[0-9٠-٩])(?=[ء-ي])|(?<=[ء-ي])(?=[0-9٠-٩])")


_TO_INDIC = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def _indic_digits(text: str) -> str:
    """The card prints its address numbers in Arabic-Indic; a stray Latin '1' is the same digit."""
    return text.translate(_TO_INDIC)


def _space_numbers(text: str) -> str:
    """'٣٥٥زهراء' → '٣٥٥ زهراء'. A soft photo closes the gap after a house number; the card always
    prints one, and no Arabic address word begins or ends with a digit.
    """
    return _NUMBER_WORD.sub(" ", text)
