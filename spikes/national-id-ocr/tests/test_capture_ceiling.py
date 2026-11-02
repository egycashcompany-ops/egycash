"""The capture only ever lowers confidence. Nothing (agreement, corroboration) lifts a field past it."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import _apply_capture_ceilings, _check_birth  # noqa: E402

VALID = "29503141234567"


def _corroborated_number(confidence: str = "high") -> dict:
    return {"value": VALID, "valid": True, "agreement": "unanimous", "confidence": confidence, "score": 0.97}


def test_a_corroborated_number_on_a_degraded_capture_stays_at_the_capture_ceiling():
    data = _corroborated_number("medium")
    _check_birth(data, "19950314", [], ceiling="medium")
    assert data["birthDateAgrees"]
    assert data["confidence"] == "medium"


def test_a_corroborated_number_on_a_refused_capture_stays_low():
    data = _corroborated_number("low")
    _check_birth(data, "19950314", [], ceiling="low")
    assert data["confidence"] == "low"


def test_corroboration_is_still_recorded_as_evidence():
    data = _corroborated_number("medium")
    _check_birth(data, "19950314", [], ceiling="medium")
    assert data.get("corroborated") is True


def test_reconciled_number_is_capped_by_its_one_side_ceiling():
    data = {**_corroborated_number("high"), "corroborated": True, "agreement": "front-only"}
    _apply_capture_ceilings(data, ["medium"])
    assert data["confidence"] == "medium"


def test_corroboration_no_longer_lifts_a_refused_capture_to_medium():
    data = {**_corroborated_number("high"), "corroborated": True, "agreement": "front-only"}
    _apply_capture_ceilings(data, ["low"])
    assert data["confidence"] == "low"


def test_one_sided_reads_take_the_lowest_ceiling_of_the_sides():
    data = {**_corroborated_number("high"), "agreement": "front-only"}
    _apply_capture_ceilings(data, ["high", "medium"])
    assert data["confidence"] == "medium"


def test_a_number_both_sides_read_alike_keeps_the_better_capture_ceiling():
    """The back alone, sharp, would have returned 'high'; a blurred front beside it agreeing
    cannot make that worse. This is not a lift: the value stands on a capture that allows it."""
    data = {**_corroborated_number("high"), "agreement": "both-sides"}
    _apply_capture_ceilings(data, ["low", "high"])
    assert data["confidence"] == "high"


def test_no_ceiling_is_ever_a_raise():
    for start in ("low", "medium", "high"):
        for ceilings in (["low"], ["medium"], ["high"], ["low", "high"]):
            data = {**_corroborated_number(start), "corroborated": True, "agreement": "both-sides"}
            _apply_capture_ceilings(data, ceilings)
            order = {"low": 0, "medium": 1, "high": 2}
            assert order[data["confidence"]] <= order[start]
