"""Confidence must never claim more than the evidence: the fix-first findings of the accuracy audit.

A field marked 'high' is one a reviewer is told they need not check, so every path that could
promote a guess, a repair or a refused photo to 'high' (or a guess to 'medium') is pinned here.
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.engine import Recognition  # noqa: E402
from nidocr.extract import SideResult, _finalize, _reconcile_national_id  # noqa: E402
from nidocr.vlm import HybridRecognizer  # noqa: E402

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


class _Base:
    id = "base"

    def recognize(self, crop, *, rtl=True):  # noqa: ARG002
        return Recognition(text="paddle", score=0.9)

    def detect_lines(self, image):  # noqa: ARG002
        return []


class _Reader:
    id = "vlm"

    def __init__(self) -> None:
        self.calls = 0

    def read(self, crop):  # noqa: ARG002
        self.calls += 1
        return "vlm"

    def close(self) -> None:
        return None


def test_a_vlm_never_reads_a_crop_after_its_field_binding_was_released():
    reader = _Reader()
    hybrid = HybridRecognizer(_Base(), reader)
    crop = np.zeros((20, 60, 3), np.uint8)
    hybrid.bind("fullNameAr")
    assert hybrid.recognize(crop).text == "vlm"
    hybrid.unbind()
    # e.g. the back's religion-gap read, which nothing binds
    assert hybrid.recognize(crop).text == "paddle"
    assert reader.calls == 1


def test_a_vlm_binding_belongs_to_the_thread_that_made_it():
    hybrid = HybridRecognizer(_Base(), _Reader())
    hybrid.bind("address")
    seen: list[str] = []
    worker = threading.Thread(
        target=lambda: seen.append(hybrid.recognize(np.zeros((5, 5, 3), np.uint8)).text)
    )
    worker.start()
    worker.join()
    assert seen == ["paddle"]
