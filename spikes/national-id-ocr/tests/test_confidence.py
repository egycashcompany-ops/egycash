"""Confidence must never claim more than the evidence: the fix-first findings of the accuracy audit.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import SideResult, _finalize, _reconcile_national_id  # noqa: E402

VALID = "29001150101435"  # structurally valid, made up


def _side(confidence: str, repaired: bool) -> SideResult:
    return SideResult(
        fields={
            "nationalId": {
                "value": VALID,
                "confidence": confidence,
                "valid": True,
                "repaired": repaired,
            }
        }
    )


def test_a_religion_deduced_from_its_position_is_not_lifted_to_medium_by_the_snap():
    assert _finalize("religion", "مسلم", 0.6)["confidence"] == "low"


def test_a_real_borderline_religion_read_is_still_corroborated_by_the_snap():
    assert _finalize("religion", "مسلم", 0.72)["confidence"] == "medium"


def test_an_address_that_is_noise_apart_from_its_governorate_stays_low():
    assert _finalize("address", "ثظ قل القاهرة", 0.3)["confidence"] == "low"


def test_two_sides_agreeing_on_a_repaired_number_is_not_high():
    agreed = _reconcile_national_id({"front": _side("medium", True), "back": _side("medium", True)})
    assert agreed["confidence"] == "medium"


def test_two_sides_agreeing_on_a_clean_read_is_high():
    agreed = _reconcile_national_id({"front": _side("high", False), "back": _side("high", False)})
    assert agreed["confidence"] == "high"


def test_a_fields_percentage_always_agrees_with_its_band():
    from nidocr.extract import ExtractionResult

    result = ExtractionResult(fields={
        "fullNameAr": {"value": "x", "confidence": "medium", "score": 0.99},  # capped: corrected
        "nationalId": {"value": "y", "confidence": "high", "score": 0.80},    # high on agreement
        "address": {"value": "z", "confidence": "low", "score": 0.95},
    })
    assert result.scores() == {"fullNameAr": 89, "nationalId": 90, "address": 69}


def test_a_digit_beside_the_card_is_dropped_from_the_occupation():
    """A keyboard key above the card was read into the job: '6 طالب'. Jobs have no digits."""
    data = _finalize("occupation", "6 طالب", 0.97)
    assert data["value"] == "طالب"
    assert data["confidence"] != "high", "a dropped word is a correction, and gets looked at"


def test_an_all_arabic_occupation_is_untouched():
    assert _finalize("occupation", "بدون عمل", 0.97)["value"] == "بدون عمل"


def test_a_disagreement_made_only_of_a_borrowed_digit_is_agreement():
    """The back's widened read took the ٢ ending the issue date: 2… against the front's 3…."""
    from nidocr.ensemble import Candidate

    true = "30512180101234"
    borrowed = "2" + true[1:]
    front = SideResult(
        fields={"nationalId": {"value": true, "confidence": "medium", "valid": True}},
        nid_candidates=[
            Candidate("grey", true, 0.97),
            Candidate("thick", true, 0.96),
            Candidate("clahe", true[1:], 0.95),
        ],
    )
    back = SideResult(
        fields={"nationalId": {"value": borrowed, "confidence": "medium", "valid": True, "widened": True}},
        nid_candidates=[
            Candidate("page", true[2:], 0.95),
            Candidate("grey", true[3:], 0.94),
            Candidate("widened2:grey", borrowed, 0.8),
        ],
    )
    agreed = _reconcile_national_id({"front": front, "back": back})
    assert agreed["value"] == true
    assert agreed["confidence"] == "high"
    assert agreed["agreement"] == "both-sides-direct"


def test_one_full_read_is_not_enough_to_wave_the_other_side_through():
    from nidocr.ensemble import Candidate

    true = "30512180101234"
    front = SideResult(
        fields={"nationalId": {"value": true, "confidence": "medium", "valid": True}},
        nid_candidates=[Candidate("grey", true, 0.97)],
    )
    back = SideResult(
        fields={"nationalId": {"value": "2" + true[1:], "confidence": "medium", "valid": True, "widened": True}},
        nid_candidates=[Candidate("page", true[2:], 0.95)],
    )
    assert _reconcile_national_id({"front": front, "back": back}).get("agreement") != "both-sides-direct"


def test_a_borrowed_digit_the_direct_reads_contradict_is_not_waved_through():
    from nidocr.ensemble import Candidate

    true = "30512180101234"
    other = "2" + true[1:-1] + "0"
    front = SideResult(fields={"nationalId": {"value": true, "confidence": "medium", "valid": True}})
    back = SideResult(
        fields={"nationalId": {"value": other, "confidence": "medium", "valid": True, "widened": True}},
        nid_candidates=[Candidate("page", other[2:], 0.95), Candidate("grey", other[3:], 0.94)],
    )
    agreed = _reconcile_national_id({"front": front, "back": back})
    assert agreed.get("agreement") != "both-sides-direct"
