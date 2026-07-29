"""Repairing a misread national ID — and, more importantly, refusing to.

Arabic-Indic numerals collide in ways Latin digits do not: ٧ and ٨ are vertical mirrors, ٢ and ٣
differ by one tooth, ٠ is a dot and ٥ a small loop. A recognizer will confuse them, and on this
particular field a single wrong digit does not give a slightly wrong answer — it gives a different,
valid-looking person.

The structure of the number is what makes correction possible: nine of its fourteen digits are
constrained by a century, a real calendar date and a list of 27 governorates. But the same
structure is what bounds it, and the boundaries are the substance of these tests. Repair must fire
where the evidence is unique, stay silent where it is not, and never touch the five digits nothing
constrains — because there, "repair" would mean turning one valid-looking number into another.

Every number here is synthetic: structurally valid, and issued to nobody.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.nid import (  # noqa: E402
    MAX_EDITS,
    gender_agrees,
    is_structurally_valid,
    repair,
)

TODAY = dt.date(2026, 7, 29)
#: Born 1995-03-14, registered in governorate 12, sequence 3456, parity digit 6 (even → female).
VALID = "29503141234567"


def _repair(raw: str):
    return repair(raw, today=TODAY)


def test_the_reference_number_is_valid():
    """Guards the rest of the file: if this drifts, every other assertion means something else."""
    assert is_structurally_valid(VALID, today=TODAY)


# ── Reading it correctly ──


@pytest.mark.parametrize(
    "raw",
    [
        "29503141234567",
        "٢٩٥٠٣١٤١٢٣٤٥٦٧",
        "٢٩٥٠٣ ١٤١٢ ٣٤٥٦٧",  # the card prints it in spaced groups
        "295-0314 123 4567",
    ],
)
def test_a_clean_read_passes_through_untouched(raw):
    fixed = _repair(raw)
    assert fixed.value == VALID
    assert fixed.valid and not fixed.repaired, "a clean read must not be reported as corrected"


@pytest.mark.parametrize(
    ("raw", "why"),
    [
        ("٢٩٥٠٣ا٤١٢٣٤٥٦٧", "alef read where ١ was printed"),
        ("٢٩ه٠٣١٤١٢٣٤٥٦٧", "ha read where ٥ was printed"),
        ("295O3141234567", "Latin O read where ٠ was printed"),
        ("295.3141234567", "a full stop read where ٠ was printed — ٠ is itself a dot"),
    ],
)
def test_letters_mistaken_for_digits_are_folded(raw, why):
    """An Arabic model handed a row of numerals sometimes returns the letter each resembles."""
    assert _repair(raw).value == VALID, why


# ── Correcting a misread, when the structure identifies it uniquely ──


def test_an_impossible_month_is_corrected_when_only_one_fix_works():
    """Month 53 cannot exist. Of the digits ٥ is confused with, only ٠ yields a real date."""
    fixed = _repair("29553141234567")
    assert (fixed.value, fixed.repaired, fixed.edits) == (VALID, True, 1)


def test_an_impossible_century_is_corrected_exhaustively():
    """The century digit's entire legal domain is {2, 3}, so trying both cannot miss the answer.

    Where a domain is this small, enumerating it beats any shape-similarity table — a table encodes
    a guess about likely misreads, enumeration cannot fail to consider the truth.
    """
    fixed = _repair("79503141234567")
    assert (fixed.value, fixed.repaired) == (VALID, True)


def test_the_nearest_correction_wins_rather_than_any_correction():
    """Searching outward by edit distance is what makes an answer meaningful rather than possible.

    A read one edit from exactly one valid number has been identified. That same read is also two
    edits from a dozen others, and pooling both distances would drown the real answer in
    coincidences — so the search stops at the first distance that yields anything.
    """
    fixed = _repair("29553141234567")
    assert fixed.repaired and fixed.edits == 1


# ── Refusing, which is most of the value ──


def test_several_equally_close_numbers_are_refused_rather_than_guessed():
    """A corrupted day-tens digit is genuinely unrecoverable: 04, 14 and 24 are all real days.

    Refusing is the correct outcome. Choosing one would hand a reviewer a plausible number for the
    wrong person, and a plausible number does not get re-read against the card.
    """
    fixed = _repair("29503741234567")
    assert fixed.ambiguous
    assert not fixed.repaired
    assert fixed.value == "29503741234567", "the raw read is preserved for the human"


def test_the_unconstrained_digits_are_never_edited():
    """Positions 10-14 are the sequence and an undocumented check digit.

    Nothing visible to this pipeline constrains them, so a misread there produces a string that is
    still perfectly valid and indistinguishable from the truth. Editing them could only ever swap
    one valid-looking identity for another, so the search must not reach them at all.
    """
    wrong_sequence = "29503141239567"  # differs from VALID only inside the free range
    fixed = _repair(wrong_sequence)
    assert fixed.valid and not fixed.repaired
    assert fixed.value == wrong_sequence, "an unconstrained digit must be left exactly as read"


def test_a_dropped_digit_is_refused_because_nothing_says_which_one():
    fixed = _repair("2950314123456")
    assert not fixed.repaired
    assert not fixed.valid


def test_a_hopeless_read_reports_failure_rather_than_inventing_a_number():
    fixed = _repair("٩٩٩٩٩٩٩٩٩٩٩٩٩٩")
    assert not fixed.valid and not fixed.repaired


def test_the_edit_budget_is_bounded():
    """Beyond a couple of edits enough strings validate that uniqueness stops discriminating."""
    assert MAX_EDITS <= 2


# ── The gender cross-check ──


@pytest.mark.parametrize(
    ("printed", "expected"),
    [
        ("أنثى", True),  # parity digit 6 is even → female
        ("انثي", True),  # the same word without its hamza or dots
        ("ذكر", False),
        ("مسلمة", None),  # not a sex at all
        ("", None),
    ],
)
def test_gender_parity_is_checked_against_the_printed_word(printed, expected):
    """Reaches a digit no structural check covers, without becoming a second source for gender.

    Digit 13 is the parity digit and sits in the unconstrained range, so structural repair cannot
    see a misread there. The back of the card states the same fact in words, and words and digits
    do not fail the same way — a recognizer that turns ٧ into ٨ does not also turn ذكر into أنثى.
    """
    assert gender_agrees(VALID, printed) is expected


def test_the_cross_check_returns_agreement_and_never_a_gender():
    """`parseNationalId` in TypeScript owns gender. This may only ever say yes, no, or don't know."""
    assert gender_agrees(VALID, "أنثى") in (True, False, None)


# ── The over-long read ──


def test_a_doubled_digit_is_recovered_from_any_position():
    """An over-long read is almost always one glyph counted twice, and that is recoverable.

    Blind deletion is close to useless here. When a 15-digit read's first nine digits already form
    a valid prefix, EVERY deletion past position nine leaves the structure intact — so the search
    finds a handful of equally valid numbers and correctly refuses all of them. A real card
    demonstrated exactly that: five valid candidates from blind deletion, and the reviewer got a
    fifteen-digit string with no derived birth date, gender or governorate.

    Restricting the search to removing a REPEAT is what makes it unique, because a repeat is the
    thing an insertion actually leaves behind. Every doubling position must come back.
    """
    for index in range(len(VALID)):
        doubled = VALID[:index] + VALID[index] + VALID[index:]
        assert len(doubled) == 15

        fixed = _repair(doubled)
        assert fixed.repaired, f"doubling digit {index} was not recovered"
        assert fixed.value == VALID, f"doubling digit {index} recovered the wrong number"


def test_an_over_long_read_with_no_repeat_still_refuses_when_ambiguous():
    """The restriction narrows the search; it does not lower the bar.

    With no repeat to remove, the general deletions are offered as before and the uniqueness rule
    decides — which for a spurious digit that duplicates nothing is usually a refusal, because
    nothing in the string says which digit was invented.
    """
    fixed = _repair("129503141234567")  # a leading digit that repeats nothing
    assert fixed.value == VALID or not fixed.repaired
