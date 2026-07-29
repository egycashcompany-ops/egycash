"""Structural validation of an Egyptian national ID — for CONFIDENCE BANDING ONLY.

This is a deliberate, narrow mirror of `parseNationalId` in
`packages/contracts/src/common/value-objects.ts`. It exists for one reason: a 14-digit string that
cannot possibly be a national ID (impossible month, unknown governorate, birth date in the future)
is almost certainly a misread, and the pipeline should hand it back as LOW confidence rather than
as a clean value a human might wave through.

It does NOT derive anything. Birth date, gender and governorate are computed exactly once, in
TypeScript, by the real `parseNationalId` — the frozen rule from the OCR seam's header comment:
"the number-derived fields are NOT part of this — they are computed downstream". Duplicating the
derivation here would create a second source of truth for a value the contract already owns.

Structure: C YYMMDD GG SSSS K
  C  = century (2 → 19xx, 3 → 20xx)
  GG = governorate code
  K  = check digit (not publicly documented — structural checks only, same as the TS side)
"""

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
    if birth > (today or _dt.date.today()):
        return False  # a card cannot belong to someone not yet born

    return value[7:9] in GOVERNORATE_CODES


def salvage_digits(raw: str) -> str:
    """Strip everything that is not a digit, after folding Indic numerals.

    OCR routinely inserts spaces inside the number (the card itself prints it in groups) and
    occasionally a stray separator. Removing non-digits BEFORE validating is what turns a
    cosmetically noisy read into a usable one; it cannot turn a wrong digit into a right one.
    """
    from .arabic import to_western_digits

    return re.sub(r"\D", "", to_western_digits(raw))


# ── Repair ───────────────────────────────────────────────────────────────────
# WHY REPAIR IS POSSIBLE AT ALL, AND WHERE IT STOPS.
#
# The number is C YYMMDD GG SSSS K. Nine of those fourteen digits are constrained by something
# outside themselves: the century digit is 2 or 3, the six date digits must form a real date that
# has already happened, and the two governorate digits must name one of 27 codes. The remaining
# five — the sequence and the check digit — are constrained by nothing this pipeline can see. Egypt
# does not publish the check-digit algorithm, so digit 14 carries no verifiable information here.
#
# That asymmetry decides the whole design. A misread digit in positions 1-9 leaves a string that
# usually cannot be a national ID, and the set of small edits that make it valid again is often a
# single candidate — so it can be repaired with evidence. A misread digit in positions 10-14 leaves
# a string that is still perfectly valid, indistinguishable from the truth, and no amount of
# searching will find it. So the search NEVER touches those positions: editing them could only ever
# turn one valid-looking number into a different valid-looking number, which is the exact failure
# this module exists to prevent.
#
# Repair therefore covers nine of fourteen digits. The gender-parity cross-check below reaches one
# more. The remaining four are the reviewer's job, which is why the review dialog exists.

#: Arabic-Indic numerals that a recognizer confuses with each other, most likely first.
#:
#: These are the shape collisions of the glyph set: ٧ and ٨ are vertical mirrors of one another and
#: are by far the most confusable pair on the card; ٢ and ٣ differ only by a tooth that low
#: resolution merges; ٠ is a dot and ٥ a small closed loop, which converge as soon as the loop fills
#: in; ٦ and ٧ are both open strokes; ٩ is ٥ with a tail, and a tail is what a fold or a smudge
#: takes first.
#:
#: These are priors reasoned from the letterforms, NOT frequencies measured on Egyptian cards — no
#: such measurement exists yet. Ordering affects only which candidate is tried first, never which
#: is accepted: acceptance requires a unique structurally valid result, so a wrong prior costs a
#: little search and cannot produce a wrong answer. `bench/` should replace these with real counts
#: once `make measure-real` has run.
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
#: An Arabic model handed a row of numerals will sometimes classify one as the letter it resembles —
#: ١ as ا, ٥ as ه — and a Latin-trained pass will offer o, l or a full stop. Folding these BEFORE
#: validation costs nothing and recovers reads that would otherwise be discarded for length.
#:
#: The full stop is the debatable one, because it is also punctuation. It is included because ٠ IS
#: a dot — that is the entire glyph — so a full stop appearing in a national-ID read is far more
#: likely to be a zero than a separator: the card prints the number in space-separated groups and
#: has no dots in it. This mapping is reached only from `repair`, which is national-ID-only;
#: `clean_expiry` parses dates through `to_western_digits` instead, where a dot IS a separator.
#: Note also that both possible mistakes here are safe. A separator wrongly read as a digit makes
#: fifteen digits, and a digit wrongly dropped makes thirteen — and length errors are refused
#: rather than guessed at, so neither can silently corrupt a number.
GLYPH_CONFUSIONS: dict[str, tuple[str, ...]] = {
    "ا": ("1",), "أ": ("1",), "ل": ("1",), "l": ("1",), "I": ("1",), "|": ("1",), "/": ("1",),
    "ه": ("5", "0"), "o": ("0", "5"), "O": ("0", "5"), "٥": ("5",),
    ".": ("0",), "·": ("0",), "،": ("0",),
    "v": ("7",), "V": ("7",), "A": ("8",), "^": ("8",),
    "q": ("9",), "g": ("9",), "s": ("5",), "S": ("5",),
}

#: Positions the structure constrains, and therefore the only ones worth editing. See the note
#: above: everything from index 9 onward is free, so a "repair" there is a coin flip wearing a
#: lab coat.
_CONSTRAINED = range(0, 9)

#: Positions whose legal values are few enough to enumerate exhaustively, and what those values are.
#:
#: The century digit is 2 or 3 and nothing else. The month's tens digit is 0 or 1. The day's tens
#: digit is 0 to 3. Where a domain is this small, trying all of it is both cheaper and strictly
#: better than consulting a shape-similarity table: the table encodes a guess about which misreads
#: are likely, whereas enumeration cannot miss the right answer at all. A confusion prior is only
#: worth having where the domain is too large to search, which for these three positions it is not.
_POSITION_DOMAIN: dict[int, str] = {0: "23", 3: "01", 5: "0123"}

#: Cap on simultaneous substitutions. Two covers the realistic case — a glare band or a fold
#: crossing the number damages adjacent digits — while keeping the candidate set small enough that
#: a unique valid answer still means something. At three or more, enough strings validate that the
#: uniqueness test stops discriminating and the search would mostly return 'ambiguous' anyway.
MAX_EDITS = 2


@dataclass(frozen=True)
class Repair:
    """The outcome of trying to make a misread number structurally possible."""

    value: str
    #: Whether `value` is structurally valid — either as read, or after repair.
    valid: bool
    #: True when `value` differs from what was read.
    repaired: bool
    #: How many digits were changed.
    edits: int = 0
    #: True when several different valid numbers were reachable, so none was chosen. This is a
    #: DELIBERATE refusal, not a failure: the read is left as-is for a human, because picking one
    #: of several plausible identities is how the wrong person ends up in a personnel file.
    ambiguous: bool = False


def _fold_glyphs(raw: str) -> str:
    """Replace the likeliest lookalike for each non-digit, then keep digits only.

    Only the single best candidate is substituted here. Offering every alternative would multiply
    the search space by the length of the string for a gain the substitution search already
    provides — that search reconsiders each digit anyway, including one this fold guessed wrong.
    """
    from .arabic import to_western_digits

    folded = "".join(
        GLYPH_CONFUSIONS[character][0] if character in GLYPH_CONFUSIONS else character
        for character in to_western_digits(raw)
    )
    return re.sub(r"\D", "", folded)


def _neighbours(candidate: str) -> set[str]:
    """Every string one edit from `candidate`, choosing the edit type by what is wrong with it.

    A read of the wrong length has a length problem; offering substitutions before it is 14 digits
    long would explore an enormous space of strings that are all still the wrong length. So a long
    read is only ever shortened, a short read only ever lengthened, and substitutions apply once
    the length is right. That ordering is what keeps a 13-digit read's search bounded.
    """
    if len(candidate) > 14:
        # A doubled digit first, and only then anything else.
        #
        # An over-long read is almost always a glyph counted twice — the recognizer sees one wide
        # ٠ as two — and treating that as the likely cause is what turns an over-long read from
        # unrecoverable into unique. Blind deletion is close to useless here: for a 15-digit string
        # whose first nine digits already form a valid prefix, EVERY deletion past position nine
        # leaves the structure intact, so the search finds a handful of equally valid numbers and
        # correctly refuses all of them. A real read demonstrated this exactly — five valid
        # candidates from blind deletion, and exactly one once the search was restricted to
        # removing a repeat.
        #
        # It is a restriction, not a preference: the general deletions are still offered when the
        # read holds no repeat at all, and the uniqueness rule still decides. This only changes
        # WHICH candidates are considered first, and the ones it prefers are the ones with a
        # mechanism behind them.
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
    """Make a misread national ID structurally possible — or refuse, and say so.

    Searches outward by edit distance and stops at the first distance that produces any valid
    number. Nearest-first is what makes the answer meaningful rather than merely possible: a read
    one digit away from exactly one valid number has been genuinely identified, whereas the same
    read is also two digits away from a dozen others, and pooling both distances would drown the
    real answer among coincidences. Closest wins, and only when it wins alone.

    A tie at the winning distance is refused, not broken. Several numbers equally close to the read
    means the pixels do not say which person this is, and a plausible-looking wrong number is worse
    than an obviously rough one — the first gets waved through the review dialog, the second gets
    read off the card.
    """
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


#: How the back of the card writes each sex, folded for comparison. Read ONLY to check the number
#: against itself — see `gender_agrees`.
_MALE = ("ذكر",)
_FEMALE = ("أنثى", "انثى", "أنثي", "انثي")


def gender_agrees(value: str, printed: str) -> bool | None:
    """Does digit 13's parity match the sex printed on the back? None when the word is unreadable.

    This is a CHECK, not a source. The pipeline's standing rule is that gender is derived from the
    number by `parseNationalId` in TypeScript and never read off the card, because a second source
    for a deterministic value is a liability. Nothing here changes that: this function returns a
    boolean about consistency and never a gender, and no caller may populate a field from it.

    What it buys is reach. Structural repair covers digits 1-9; digit 13 is the parity digit and is
    otherwise unconstrained, so a misread there is invisible. The back of the card states the same
    fact in words, and words and digits do not fail in the same way — a recognizer that turns ٧ into
    ٨ does not simultaneously turn ذكر into أنثى. When they disagree, one of the two is wrong and
    the reviewer needs to know; that is worth one comparison.
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
