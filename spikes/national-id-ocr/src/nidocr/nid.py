"""Structural validation of an Egyptian national ID, for confidence banding only."""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass

# Same table as EGYPT_GOVERNORATE_CODES in the contracts package. Kept as a set of codes rather
# than a code→name map: naming the governorate is the TypeScript side's job, not ours.
GOVERNORATE_CODES = frozenset(
    {
        "01", "02", "03", "04", "11", "12", "13", "14", "15", "16", "17", "18", "19",
        "21", "22", "23", "24", "25", "26", "27", "28", "29",
        "31", "32", "33", "34", "35", "88",
    }
)

_FOURTEEN_DIGITS = re.compile(r"^\d{14}$")

#: Ages a card holder can have. The card is issued at 16 (15 leaves a year for a birthday
#: misread by a day); 105 is older than any card in circulation will be read for.
MIN_HOLDER_AGE = 15
MAX_HOLDER_AGE = 105


def is_structurally_valid(value: str, *, today: _dt.date | None = None) -> bool:
    """True when `value` could be a real Egyptian national ID. No derivation, no side effects."""
    if not _FOURTEEN_DIGITS.match(value):
        return False

    century = value[0]
    if century not in ("2", "3"):
        return False
    base = 1900 if century == "2" else 2000

    year = base + int(value[1:3])
    month = int(value[3:5])
    day = int(value[5:7])
    try:
        birth = _dt.date(year, month, day)
    except ValueError:
        return False  # impossible calendar date (month 13, 31 February, …)
    today = today or _dt.date.today()
    if birth > today:
        return False  # a card cannot belong to someone not yet born
    # A card is issued at 16 and its holder is alive. Without this, a misread century digit
    # (٣ read as ٢) still "validated" as someone born in 1903 or 1904, and was handed back as read.
    age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
    if not MIN_HOLDER_AGE <= age <= MAX_HOLDER_AGE:
        return False

    return value[7:9] in GOVERNORATE_CODES


def salvage_digits(raw: str) -> str:
    """Strip everything that is not a digit, after folding Indic numerals."""
    from .arabic import to_western_digits

    return re.sub(r"\D", "", to_western_digits(raw))


# ── Repair ───────────────────────────────────────────────────────────────────
# Why repair is possible at all, and where it stops.
#
# The number is C YYMMDD GG SSSS K. Nine of those fourteen digits are constrained by something
# outside themselves: the century digit is 2 or 3, the six date digits must form a real date that
# has already happened, and the two governorate digits must name one of 27 codes. The remaining
# five, the sequence and the check digit, are constrained by nothing this pipeline can see. Egypt
# does not publish the check-digit algorithm, so digit 14 carries no verifiable information here.
#
# That asymmetry decides the whole design. A misread digit in positions 1-9 leaves a string that
# usually cannot be a national ID, and the set of small edits that make it valid again is often a
# single candidate, so it can be repaired with evidence. A misread digit in positions 10-14 leaves
# a string that is still perfectly valid, indistinguishable from the truth, and no amount of
# searching will find it. So the search never touches those positions: editing them could only ever
# turn one valid-looking number into a different valid-looking number, which is the exact failure
# this module exists to prevent.
#
# Repair therefore covers nine of fourteen digits. The gender-parity cross-check below reaches one
# more. The remaining four are the reviewer's job, which is why the review dialog exists.

#: Arabic-Indic numerals that a recognizer confuses with each other, most likely first.
DIGIT_CONFUSIONS: dict[str, tuple[str, ...]] = {
    "0": ("5", "9"),
    "1": ("2",),
    "2": ("3", "1"),
    "3": ("2", "4"),
    "4": ("3",),
    "5": ("0", "9", "6"),
    "6": ("7", "5"),
    "7": ("8", "6"),
    "8": ("7",),
    "9": ("5", "0"),
}

#: Characters a recognizer emits where a digit was printed, and what they were most likely reading.
GLYPH_CONFUSIONS: dict[str, tuple[str, ...]] = {
    # Not "/": the number never carries one and every date printed beside it does, so a slash
    # read as ١ turned '2003/07/25' into digits of the number (see `_fold_glyphs`).
    "ا": ("1",), "أ": ("1",), "ل": ("1",), "l": ("1",), "I": ("1",), "|": ("1",),
    "ه": ("5", "0"), "o": ("0", "5"), "O": ("0", "5"), "٥": ("5",),
    ".": ("0",), "·": ("0",), "،": ("0",),
    "v": ("7",), "V": ("7",), "A": ("8",), "^": ("8",),
    "q": ("9",), "g": ("9",), "s": ("5",), "S": ("5",),
}

#: Positions the structure constrains, and therefore the only ones worth editing.
_CONSTRAINED = range(0, 9)

#: Positions whose legal values are few enough to enumerate exhaustively, and what those values
#: are.
_POSITION_DOMAIN: dict[int, str] = {0: "23", 3: "01", 5: "0123"}

#: Cap on simultaneous substitutions.
MAX_EDITS = 2


@dataclass(frozen=True)
class Repair:
    """The outcome of trying to make a misread number structurally possible."""

    value: str
    #: Whether `value` is structurally valid, either as read, or after repair.
    valid: bool
    #: True when `value` differs from what was read.
    repaired: bool
    #: How many digits were changed.
    edits: int = 0
    #: True when several different valid numbers were reachable, so none was chosen.
    ambiguous: bool = False


#: A printed date, YYYY/MM or YYYY/MM/DD, with whatever separator the recognizer saw.
_DATE_IN_TEXT = re.compile(r"(?:19|20)\d{2}\s*[-/\.|]\s*\d{1,2}(?:\s*[-/\.|]\s*\d{1,2})?")


def _fold_glyphs(raw: str) -> str:
    """Replace the likeliest lookalike for each non-digit, then keep digits only."""
    from .arabic import to_western_digits

    # A date read along with the number (the front prints the birth date beside it, the back the
    # issue date) is taken out whole first, separators and all, so none of it joins the number.
    text = _DATE_IN_TEXT.sub(" ", to_western_digits(raw))
    folded = "".join(
        GLYPH_CONFUSIONS[character][0] if character in GLYPH_CONFUSIONS else character
        for character in text
    )

    # A crop that also caught a neighbouring number must not defeat the read.
    runs = [run for run in re.findall(r"\d+", folded) if len(run) == 14]
    if len(runs) == 1:
        return runs[0]

    return re.sub(r"\D", "", folded)


def _neighbours(candidate: str) -> set[str]:
    """Every string one edit from `candidate`, choosing the edit type by what is wrong with it."""
    if len(candidate) > 14:
        # A doubled digit first, and only then anything else.
        repeats = {
            candidate[:i] + candidate[i + 1 :]
            for i in range(len(candidate))
            if (i > 0 and candidate[i] == candidate[i - 1])
            or (i + 1 < len(candidate) and candidate[i] == candidate[i + 1])
        }
        return repeats or {candidate[:i] + candidate[i + 1 :] for i in range(len(candidate))}
    if len(candidate) < 14:
        return {
            candidate[:i] + inserted + candidate[i:]
            for i in range(len(candidate) + 1)
            for inserted in "0123456789"
        }
    return {
        candidate[:i] + alternative + candidate[i + 1 :]
        for i in _CONSTRAINED
        for alternative in _POSITION_DOMAIN.get(i, DIGIT_CONFUSIONS.get(candidate[i], ()))
        if alternative != candidate[i]
    }


def repair(raw: str, *, today: _dt.date | None = None, max_edits: int = MAX_EDITS) -> Repair:
    """Make a misread national ID structurally possible, or refuse, and say so."""
    digits = _fold_glyphs(raw)
    frontier = {digits}
    seen = {digits}

    for cost in range(max_edits + 1):
        valid = {
            candidate
            for candidate in frontier
            if len(candidate) == 14 and is_structurally_valid(candidate, today=today)
        }
        if len(valid) == 1:
            return Repair(valid.pop(), valid=True, repaired=cost > 0, edits=cost)
        if len(valid) > 1:
            return Repair(digits, valid=False, repaired=False, ambiguous=True)

        grown: set[str] = set()
        for candidate in frontier:
            grown |= _neighbours(candidate)
        frontier = grown - seen
        seen |= frontier

    return Repair(digits, valid=False, repaired=False)


#: How the back of the card writes each sex, folded for comparison. Read only to check the number
#: against itself, see `gender_agrees`.
_MALE = ("ذكر",)
_FEMALE = ("أنثى", "انثى", "أنثي", "انثي")


def gender_agrees(value: str, printed: str) -> bool | None:
    """Does digit 13's parity match the sex printed on the back? None when the word is unreadable.
    """
    from .arabic import normalize_arabic, rasm_fold

    if not re.match(r"^\d{13}", value or ""):
        return None
    folded = rasm_fold(printed)
    male = folded in {rasm_fold(word) for word in _MALE}
    female = folded in {rasm_fold(word) for word in _FEMALE}
    if male == female:  # unrecognised, or somehow both
        normalized = normalize_arabic(printed)
        male = any(normalize_arabic(word) in normalized for word in _MALE)
        female = any(normalize_arabic(word) in normalized for word in _FEMALE)
        if male == female:
            return None
    return (int(value[12]) % 2 == 1) == male
