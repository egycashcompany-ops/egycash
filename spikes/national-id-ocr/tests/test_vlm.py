"""The VLM readers' wiring, without a model: which fields they may touch, and where confidence
comes from.

Built on the MockRecognizer pattern: the mock stands in for PaddleOCR (replaying the truth per
field), and a fake reader stands in for the VLM. What is under test is everything except the
models — routing, agreement scoring, failure handling and the comparison table.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "bench"))

from nidocr.engine import MockRecognizer  # noqa: E402
from nidocr.extract import extract  # noqa: E402
from nidocr.vlm import (  # noqa: E402
    VLM_FIELDS,
    HybridRecognizer,
    agreement,
    build_recognizer,
    clean_transcription,
)

FIXTURES = ROOT / "fixtures" / "synthetic"
CROP = np.full((60, 300, 3), 230, np.uint8)


class _Reader:
    """A VLM stand-in: returns a fixed text and records how often it was asked."""

    id = "fake-vlm"

    def __init__(self, text: str = "", fail: bool = False) -> None:
        self.text = text
        self.fail = fail
        self.calls = 0

    def read(self, crop):  # noqa: ANN001, ARG002
        self.calls += 1
        if self.fail:
            raise RuntimeError("model crashed")
        return self.text

    def close(self) -> None:
        pass


# ── Agreement: the only source of a VLM field's confidence ──


def test_identical_readings_agree_fully():
    assert agreement("محمد رضوان", "محمد رضوان") == 1.0


def test_a_lost_dot_is_not_disagreement():
    """PaddleOCR drops dots that a VLM keeps; rasm folding makes that a match, not a miss."""
    assert agreement("مسلمة", "مسلمه") == 1.0
    assert agreement("الحديدى", "الحديدي") == 1.0


def test_word_splitting_is_not_disagreement():
    assert agreement("عبد الرحمن", "عبدالرحمن") == 1.0


def test_unrelated_readings_barely_agree():
    assert agreement("محمد رضوان الحديدى", "شارع النيل القاهرة") < 0.5


def test_nothing_read_is_no_agreement():
    assert agreement("", "") == 0.0
    assert agreement("", "محمد") == 0.0


def test_a_transcription_is_cleaned_to_one_line_of_text():
    raw = '<think>\nreasoning\n</think>\n"محمد رضوان\nالحديدى"  '
    assert clean_transcription(raw) == "محمد رضوان الحديدى"


# ── Routing: which fields a VLM may read ──


def test_only_the_three_prose_fields_go_to_the_vlm():
    assert VLM_FIELDS == {"fullNameAr", "address", "occupation"}


def test_a_prose_field_takes_the_vlm_text_scored_by_agreement():
    base = MockRecognizer({"fullNameAr": "محمد رضوان الحديدى"})
    reader = _Reader("محمد رضوان الحديدي")
    hybrid = HybridRecognizer(base, reader)
    hybrid.bind("fullNameAr")

    out = hybrid.recognize(CROP)
    assert out.text == "محمد رضوان الحديدي", "the field value is the VLM's reading"
    assert out.score == 1.0, "and its confidence is agreement with PaddleOCR, not the model's"
    assert reader.calls == 1


def test_disagreement_lowers_the_score_whatever_the_vlm_thinks():
    base = MockRecognizer({"address": "٣٤ ش الجمهورية المنصورة"}, score=0.99)
    hybrid = HybridRecognizer(base, _Reader("برج الشروق ش أحمد ماهر"))
    hybrid.bind("address")
    assert hybrid.recognize(CROP).score < 0.5


@pytest.mark.parametrize("field", ["nationalId", "nationalIdExpiry", "religion", "maritalStatus"])
def test_numbers_and_vocabulary_fields_never_reach_the_vlm(field):
    base = MockRecognizer({field: "29008040395767"})
    reader = _Reader("12345678901234")
    hybrid = HybridRecognizer(base, reader)
    hybrid.bind(field)

    out = hybrid.recognize(CROP)
    assert out.text == "29008040395767", f"{field} must come from PaddleOCR"
    assert reader.calls == 0, f"the VLM was asked to read {field}"


def test_an_unreadable_crop_comes_back_empty_with_no_confidence():
    base = MockRecognizer({"occupation": "مهندس"})
    hybrid = HybridRecognizer(base, _Reader(""))
    hybrid.bind("occupation")
    out = hybrid.recognize(CROP)
    assert out.text == "" and out.score == 0.0


def test_a_vlm_crash_costs_the_vlm_read_not_the_field():
    base = MockRecognizer({"fullNameAr": "محمد"})
    hybrid = HybridRecognizer(base, _Reader(fail=True))
    hybrid.bind("fullNameAr")
    assert hybrid.recognize(CROP).text == "محمد"


def test_whole_card_detection_is_always_paddleocr():
    lines = [([[0, 0], [1, 0], [1, 1], [0, 1]], "نص", 0.9)]
    reader = _Reader("anything")
    hybrid = HybridRecognizer(MockRecognizer({}, lines=lines), reader)
    assert hybrid.detect_lines(CROP) == lines
    assert reader.calls == 0


@pytest.mark.skipif(not (FIXTURES / "manifest.json").exists(), reason="run `make fixtures` first")
def test_end_to_end_the_vlm_fills_only_its_fields():
    """Through the real pipeline: the VLM's text lands in the prose fields, the number does not."""
    entry = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))[0]
    truth = entry["truth"]
    reader = _Reader(truth["fullNameAr"])
    hybrid = HybridRecognizer(MockRecognizer(dict(truth)), reader)

    result = extract(str(FIXTURES / entry["front"]), str(FIXTURES / entry["back"]), hybrid)
    fields = result.as_raw_ocr_result()
    assert fields["fullNameAr"]["value"] == truth["fullNameAr"]
    assert fields["nationalId"]["value"] == truth["nationalId"]
    assert reader.calls >= 3, "name, address and occupation should each have been read"


# ── Selection ──


def test_an_unknown_recognizer_is_refused_by_name(monkeypatch):
    monkeypatch.setenv("OCR_TEXT_RECOGNIZER", "gpt")
    with pytest.raises(ValueError, match="paddle, paddleocr_vl, qwen"):
        build_recognizer()


# ── The comparison table ──


def _report(name: str, normalized: float, passes: bool) -> dict:
    field = {
        "exactPct": 50.0,
        "normalizedPct": normalized,
        "meanCer": 0.1,
        "missing": 0,
        "passes": passes,
        "threshold": 0.80,
    }
    return {
        "recognizer": name,
        "fixtureSet": "fixtures/synthetic",
        "images": 8,
        "syntheticOnly": True,
        "fields": {"fullNameAr": field, "nationalId": dict(field, passes=True, threshold=0.95)},
        "resources": {
            "dockerImageMb": 2257.0,
            "peakRssMb": 850.0,
            "cpuSecondsPerCard": 13.4,
            "wallSecondsPerCard": 1.3,
        },
        "verdict": {"fieldsBelowThreshold": [] if passes else ["fullNameAr"]},
    }


def test_the_comparison_is_one_table_labelled_inconclusive_on_synthetic_cards():
    from compare import render

    table = render([_report("paddle", 75.0, False), _report("qwen", 100.0, True)])
    assert "INCONCLUSIVE" in table
    assert "| `fullNameAr` | 80% | 50.0 / 75.0 ✗ / 0.1 / 0 | 50.0 / 100.0 ✓ / 0.1 / 0 |" in table
    for row in ("Image size (MB)", "Peak RAM (MB)", "CPU seconds / card", "Wall seconds / card"):
        assert row in table


def test_a_vlm_is_shown_a_shrunk_crop_never_an_enlarged_one():
    from nidocr.vlm import VLM_MAX_HEIGHT, VLM_MAX_WIDTH, fit_for_vlm

    big = np.zeros((350, 1500, 3), np.uint8)
    small = np.zeros((40, 200, 3), np.uint8)
    shrunk = fit_for_vlm(big)
    assert shrunk.shape[0] <= VLM_MAX_HEIGHT and shrunk.shape[1] <= VLM_MAX_WIDTH
    assert abs(shrunk.shape[1] / shrunk.shape[0] - 1500 / 350) < 0.05
    assert fit_for_vlm(small) is small
