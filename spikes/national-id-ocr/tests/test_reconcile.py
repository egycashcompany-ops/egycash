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

from nidocr.ensemble import Candidate  # noqa: E402
from nidocr.extract import SideResult, _better, _printed_gender, _reconcile_national_id  # noqa: E402

VALID = "29503141234567"
#: A second valid number, differing everywhere — for the case where the two sides disagree
#: outright rather than by a digit. Invented, like every number in this repository.
OTHER_VALID = "30105202143210"


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


# ── Resolving a disagreement by pooling the readings behind it ──


def _side_with_reads(value: str, *, valid: bool, reads: list[tuple[str, float]]) -> SideResult:
    side = _side(value, valid=valid, confidence="high")
    side.nid_candidates = [
        Candidate(variant=f"v{index}", digits=digits, score=score)
        for index, (digits, score) in enumerate(reads)
    ]
    return side


def test_a_disagreement_is_resolved_by_the_readings_behind_the_two_values():
    """Comparing two finished values can only report that they differ. The reads can do better.

    Each side ran five preprocessing variants, so ten opinions exist on each of the fourteen
    digits — and the front and back crops share no pixels at all, which makes their errors the most
    independent evidence in this pipeline. A digit misread on the front has to be misread
    identically on the back to survive the pool.

    Here the front settled on a number only one of its variants read, while three of the four other
    reads across both sides agree on another. The disagreement is not a coin flip; it has a
    majority, and the majority is what the card says.
    """
    front = _side_with_reads(OTHER_VALID, valid=True, reads=[(OTHER_VALID, 0.99), (VALID, 0.7)])
    back = _side_with_reads(VALID, valid=True, reads=[(VALID, 0.8), (VALID, 0.8)])

    combined = _reconcile_national_id({"front": front, "back": back})
    assert combined["value"] == VALID
    assert combined["confidence"] == "medium", "a resolved conflict is not a clean read"
    assert combined["agreement"] == "cross-side-majority"


def test_an_evenly_split_pool_is_still_a_conflict():
    """Resolution requires a majority, not a winner.

    Two numbers with equal support is not evidence for either — it is two numbers. Choosing by
    score would hand a reviewer a plausible number for possibly the wrong person, which is the one
    outcome that does not get re-read against the card.
    """
    front = _side_with_reads(VALID, valid=True, reads=[(VALID, 0.9), (VALID, 0.9)])
    back = _side_with_reads(OTHER_VALID, valid=True, reads=[(OTHER_VALID, 0.9), (OTHER_VALID, 0.9)])

    combined = _reconcile_national_id({"front": front, "back": back})
    assert combined["confidence"] == "low"
    assert combined["agreement"] == "conflict"


def test_the_sides_agreeing_outright_is_still_the_strongest_outcome():
    """Pooling resolves disagreements; it does not replace agreement, which needs no resolving."""
    front = _side_with_reads(VALID, valid=True, reads=[(VALID, 0.8)])
    back = _side_with_reads(VALID, valid=True, reads=[(VALID, 0.8)])

    combined = _reconcile_national_id({"front": front, "back": back})
    assert combined["confidence"] == "high" and combined["agreement"] == "both-sides"


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


# ── A failing detector must not cost the card ──


class _ExplodingDetector:
    """Recognizes fields fine, but blows up on full-page detection — the observed production shape.

    PaddleOCR's static predictor is native code with no Python-level failure mode: a concurrent
    call came back as `RuntimeError: std::exception` from inside C++. Whatever the cause, the
    question this asks is what the pipeline does about it.
    """

    id = "exploding"

    def detect_lines(self, image):  # noqa: ARG002
        raise RuntimeError("std::exception")

    def recognize(self, crop, *, rtl=True):  # noqa: ARG002
        from nidocr.engine import Recognition

        return Recognition(text="محمد احمد", score=0.9)


def test_a_detection_failure_falls_back_to_nominal_boxes(tmp_path):
    """Anchoring is an improvement on the geometry, so losing it must cost the correction only.

    It was costing the whole read: the exception left `extract`, the service turned it into a 500,
    and a card that would have produced six usable fields produced none. Per-field recognition
    failures were already tolerated one field at a time; detection was the single call that could
    still take the request down with it.
    """
    import cv2
    import numpy as np

    from nidocr.extract import extract

    card = np.full((646, 1024, 3), 220, np.uint8)
    front = tmp_path / "front.jpg"
    cv2.imwrite(str(front), card)

    result = extract(str(front), None, _ExplodingDetector())

    assert result.fields, "a detection failure emptied the whole read"
    assert result.diagnostics["front"]["boxSources"] == {"nominal": 3}, (
        "boxes should fall back to the profile geometry, not vanish"
    )


# ── Catching the front photographed twice ──


def test_a_front_image_submitted_as_the_back_is_flagged():
    """The commonest two-sided capture mistake, and the one with the least legible symptom.

    Applying the back's boxes to a front image returns whatever sits at those coordinates —
    a fragment of the address arrives as a religion, and nothing about that says "wrong image".
    """
    from nidocr.extract import _looks_like_the_back

    front_lines = [
        ([[0, 0], [10, 0], [10, 10], [0, 10]], "ندى محمد رضوان الحديدى عبده", 0.9),
        ([[0, 20], [10, 20], [10, 30], [0, 30]], "برج الشروق ش أحمد ماهر المنصورة أول", 0.9),
    ]
    assert _looks_like_the_back(front_lines) is False

    back_lines = [
        ([[0, 0], [10, 0], [10, 10], [0, 10]], "معيدة بقسم الصحة العامة", 0.9),
        ([[0, 20], [10, 20], [10, 30], [0, 30]], "أنثى مسلمة متزوجة", 0.9),
    ]
    assert _looks_like_the_back(back_lines) is True


def test_an_unreadable_side_is_not_accused_of_being_the_wrong_side():
    """No text is not evidence of a wrong image, and flagging it would send people to re-shoot a
    side they photographed correctly."""
    from nidocr.extract import _looks_like_the_back

    assert _looks_like_the_back([]) is None
    assert _looks_like_the_back([([[0, 0], [1, 0], [1, 1], [0, 1]], "   ", 0.1)]) is None
