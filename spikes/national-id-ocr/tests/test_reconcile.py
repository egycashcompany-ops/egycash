"""Reading the national ID from both sides of the card, and combining the two.

The number is printed on the front AND the back of an Egyptian ID. Reading it twice is the cheapest
accuracy available anywhere in this pipeline, because the two crops share no pixels: their errors
are independent, so agreement between them is far stronger evidence than either model score. A
score says how cleanly the recognizer read what it was shown. Agreement says two different regions
of the card said the same thing.

Disagreement is worth just as much, and is handled by refusing to choose. This field is the one
where being confidently wrong is most expensive — a single wrong digit does not give a slightly
wrong answer, it gives a different, valid-looking person — so a conflict drops to `low` and the
reviewer settles it against the card in their hand.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import SideResult, _better, _printed_gender, _reconcile_national_id  # noqa: E402

VALID = "29503141234567"
OTHER_VALID = "28709011202408"


def _side(value: str, *, valid: bool, confidence: str = "medium") -> SideResult:
    return SideResult(
        fields={"nationalId": {"value": value, "confidence": confidence, "valid": valid, "score": 0.8}}
    )


# ── Combining the two reads ──


def test_agreement_between_the_sides_raises_confidence():
    """Two independent crops landing on the same fourteen digits outrank either model score."""
    combined = _reconcile_national_id(
        {"front": _side(VALID, valid=True), "back": _side(VALID, valid=True)}
    )
    assert combined["value"] == VALID
    assert combined["confidence"] == "high"
    assert combined["agreement"] == "both-sides"


def test_agreement_on_an_impossible_number_is_still_low():
    """Read twice does not make it true. A structural failure outranks corroboration."""
    combined = _reconcile_national_id(
        {"front": _side("99999999999999", valid=False), "back": _side("99999999999999", valid=False)}
    )
    assert combined["confidence"] == "low"


def test_a_valid_read_is_preferred_over_an_invalid_one_but_capped():
    """Choosing by structure is inference, not reading, so it must not claim the top band."""
    combined = _reconcile_national_id(
        {
            "front": _side("29503141234567", valid=True, confidence="high"),
            "back": _side("11111111111111", valid=False),
        }
    )
    assert combined["value"] == VALID
    assert combined["confidence"] == "medium"
    assert combined["agreement"] == "one-side-invalid"


def test_two_different_valid_numbers_are_a_conflict_not_a_choice():
    """Both plausible and different means the pixels do not say which person this is.

    Picking one by score would hand the reviewer a number for possibly the wrong person, and a
    number that looks decided does not get re-read.
    """
    combined = _reconcile_national_id(
        {
            "front": _side(VALID, valid=True, confidence="high"),
            "back": _side(OTHER_VALID, valid=True, confidence="high"),
        }
    )
    assert combined["confidence"] == "low"
    assert combined["agreement"] == "conflict"


def test_one_side_alone_passes_through_unchanged():
    combined = _reconcile_national_id({"front": _side(VALID, valid=True, confidence="high")})
    assert combined["confidence"] == "high"
    assert "agreement" not in combined


def test_no_reading_at_all_yields_nothing():
    assert _reconcile_national_id({}) is None
    assert _reconcile_national_id({"front": _side("", valid=False)}) is None


# ── Choosing between an upright and an inverted pass ──


def test_a_structurally_valid_read_beats_a_fuller_but_invalid_one():
    """Orientation is settled by which pass produced a usable number, not by which found more text.

    An upside-down card puts every box on the wrong text, so it tends to yield fragments — several
    fields with something in them and a national ID that cannot be one. Counting fields alone would
    pick that pass.
    """
    upright = SideResult(fields={"nationalId": {"value": VALID, "valid": True, "score": 0.7}})
    inverted = SideResult(
        fields={
            "nationalId": {"value": "0000", "valid": False, "score": 0.9},
            "address": {"value": "شيء ما", "score": 0.9},
            "fullNameAr": {"value": "اسم", "score": 0.9},
        }
    )
    assert _better(upright, inverted) is upright


def test_more_recovered_fields_wins_when_neither_number_is_valid():
    thin = SideResult(fields={"address": {"value": "أ", "score": 0.9}})
    full = SideResult(
        fields={"address": {"value": "أ", "score": 0.5}, "fullNameAr": {"value": "ب", "score": 0.5}}
    )
    assert _better(thin, full) is full


# ── The gender cross-check reads from lines, not from a field ──


def test_the_printed_sex_is_found_among_detected_lines():
    """Deliberately not a field box.

    `parseNationalId` owns gender, and giving it a box would invite something downstream to start
    populating from it. Taken from the detection output, it can only ever reach the consistency
    check.
    """
    lines = [
        ([[0, 0], [10, 0], [10, 10], [0, 10]], "مهندس مدني", 0.9),
        ([[0, 20], [10, 20], [10, 30], [0, 30]], "أنثى مسلمة متزوجة", 0.9),
    ]
    assert _printed_gender(lines) == "أنثى"
    assert _printed_gender([lines[0]]) is None
