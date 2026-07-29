"""Model-free tests: everything except the recognizer itself.

These run with no model weights and no network, which is what lets the pipeline be regression-
tested in CI and in restricted environments. What they cover is precisely the half of the system
that a PaddleOCR accuracy number would NOT tell you about — geometry, digit folding, structural
validation, post-processing and scoring. A break in any of those looks identical to bad OCR in a
report, so pinning them separately is what keeps the eventual accuracy verdict interpretable.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.arabic import normalize_arabic, to_western_digits  # noqa: E402
from nidocr.engine import MockRecognizer, _flatten_paddle_result  # noqa: E402
from nidocr.extract import extract  # noqa: E402
from nidocr.layout import ALL_FIELD_NAMES, BACK_FIELDS, FRONT_FIELDS  # noqa: E402
from nidocr.nid import is_structurally_valid, salvage_digits  # noqa: E402
from nidocr.postprocess import (  # noqa: E402
    band,
    clean_expiry,
    clean_marital_status,
    clean_national_id,
    clean_religion,
)
from nidocr.scoring import character_error_rate, score_field  # noqa: E402

FIXTURES = ROOT / "fixtures" / "synthetic"


# ── Arabic-Indic digits: the single most load-bearing conversion in the pipeline ──


def test_indic_digits_fold_to_ascii():
    assert to_western_digits("٢٩٢٠٨١٥١٢٠٣٤٥٧") == "29208151203457"
    assert to_western_digits("۲۰۲۶") == "2026"  # Persian/Extended set folds too


def test_indic_conversion_leaves_arabic_letters_alone():
    assert to_western_digits("مسلم") == "مسلم"


def test_normalize_matches_the_api_fold():
    # Same expectations as apps/api/src/modules/hr/shared/arabic.spec.ts
    assert normalize_arabic("أحمد") == normalize_arabic("احمد")
    assert normalize_arabic("مرزوقة") == "مرزوقه"
    assert normalize_arabic("  علي   حسن ") == "علي حسن"


# ── National-ID structure (confidence banding only — derivation stays in TypeScript) ──


@pytest.mark.parametrize(
    "value",
    ["29208151203457", "30001011200015"],
)
def test_valid_ids_accepted(value):
    assert is_structurally_valid(value, today=dt.date(2026, 7, 28))


@pytest.mark.parametrize(
    ("value", "why"),
    [
        ("1920815120345", "wrong length"),
        ("49208151203457", "century digit is neither 2 nor 3"),
        ("29913011203457", "month 13"),
        ("29902301203457", "30 February"),
        ("29801019934567", "unknown governorate code"),
        ("39912011203457", "birth date in the future"),
    ],
)
def test_invalid_ids_rejected(value, why):
    assert not is_structurally_valid(value, today=dt.date(2026, 7, 28)), why


def test_salvage_strips_separators_and_folds_digits():
    assert salvage_digits("٢٩٢٠٨ ١٥١٢٠٣٤٥٧") == "29208151203457"
    assert salvage_digits("292-081 5120.3457") == "29208151203457"


def test_salvage_cannot_rescue_a_wrong_digit():
    """Cosmetic noise is removable; a misread digit is not. Guards against false comfort."""
    assert salvage_digits("29208151203458") != "29208151203457"


# ── Post-processing ──


def test_national_id_cleanup_reports_validity():
    fixed = clean_national_id("٢٩٢٠٨ ١٥١٢٠٣٤٥٧")
    assert (fixed.value, fixed.valid) == ("29208151203457", True)
    assert not fixed.repaired, "a clean read must not be reported as corrected"


def test_structural_failure_forces_low_confidence():
    """A confident model must not produce a 'high' band on an impossible value."""
    fixed = clean_national_id("٩٩٩٩٩٩٩٩٩٩٩٩٩٩")
    assert band(0.99, structurally_valid=fixed.valid) == "low"


def test_band_never_upgrades_on_structural_success():
    assert band(0.40, structurally_valid=True) == "low"


def test_expiry_parses_indic_date_to_iso():
    assert clean_expiry("٢٠٢٢/٠٧/٠٤") == ("2022-07-04", True)


def test_expiry_keeps_text_when_unparseable():
    value, parsed = clean_expiry("٢٠٢٢/٧")
    assert parsed is False and value  # returns something a human can correct, not nothing


def test_expiry_rejects_impossible_date():
    _, parsed = clean_expiry("٢٠٢٢/١٣/٤٠")
    assert parsed is False


def test_religion_snaps_through_orthographic_variation():
    assert clean_religion("مسلمه")[0] == "مسلمة"


def test_marital_snaps_from_a_partial_read():
    value, snapped = clean_marital_status("متزوج")
    assert snapped and value == "متزوج"


def test_unknown_vocabulary_value_is_left_alone():
    """Never invent a term the pixels do not support."""
    value, snapped = clean_religion("قققق")
    assert not snapped and value == "قققق"


# ── Scoring ──


def test_cer_is_zero_for_identical_and_one_for_disjoint():
    assert character_error_rate("مسلم", "مسلم") == 0.0
    assert character_error_rate("", "مسلم") == 1.0


def test_normalized_match_forgives_hamza_but_exact_does_not():
    result = score_field("fullNameAr", "احمد", "أحمد")
    assert result.normalized and not result.exact


def test_missing_flags_an_empty_read_against_a_real_truth():
    assert score_field("address", "", "المنصورة").missing


# ── Paddle result shapes (a version bump must not silently yield zero fields) ──


def test_flatten_handles_3x_dict_shape():
    payload = [{"rec_texts": ["مسلم", "متزوج"], "rec_scores": [0.98, 0.91]}]
    assert _flatten_paddle_result(payload) == [("مسلم", 0.98), ("متزوج", 0.91)]


def test_flatten_handles_2x_nested_shape():
    payload = [[[[[0, 0], [1, 0], [1, 1], [0, 1]], ("مسلم", 0.97)]]]
    assert _flatten_paddle_result(payload) == [("مسلم", 0.97)]


def test_flatten_handles_empty():
    assert _flatten_paddle_result([]) == []
    assert _flatten_paddle_result(None) == []


# ── Layout + end-to-end plumbing over the real fixtures ──


def test_field_names_are_unique_across_both_sides():
    assert len(ALL_FIELD_NAMES) == len(set(ALL_FIELD_NAMES))


def test_boxes_stay_inside_the_card():
    for box in (*FRONT_FIELDS, *BACK_FIELDS):
        left, top, right, bottom = box.to_pixels()
        assert 0 <= left < right and 0 <= top < bottom


@pytest.mark.skipif(not (FIXTURES / "manifest.json").exists(), reason="run `make fixtures` first")
def test_extract_produces_every_field_for_every_fixture():
    """Full pipeline over real images with recognition held constant.

    Proves rectification, cropping, field attribution and post-processing work on degraded
    images — the parts an accuracy number would otherwise conflate with model quality.
    """
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    assert manifest, "fixture set is empty"

    for entry in manifest:
        recognizer = MockRecognizer(dict(entry["truth"]))
        result = extract(
            str(FIXTURES / entry["front"]), str(FIXTURES / entry["back"]), recognizer
        )
        assert set(result.fields) == set(ALL_FIELD_NAMES)
        assert result.total_ms > 0
        payload = result.as_raw_ocr_result()
        assert payload["nationalId"]["value"] == entry["truth"]["nationalId"]
        assert payload["nationalId"]["confidence"] in ("high", "medium", "low")
