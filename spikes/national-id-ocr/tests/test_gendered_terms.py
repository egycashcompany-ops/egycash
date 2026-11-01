"""A woman's card gets the feminine words: the sex (printed, or the number's digit 13) settles it."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import _holder_is_female  # noqa: E402
from nidocr.postprocess import agree_with_sex  # noqa: E402

FEMALE_NUMBER = "29503141234567"[:12] + "2" + "7"  # digit 13 even
MALE_NUMBER = "29503141234567"[:12] + "3" + "7"  # digit 13 odd


def _field(value: str, confidence: str = "high") -> dict:
    return {"value": value, "confidence": confidence}


def test_a_dropped_ta_marbuta_is_restored_on_a_womans_card():
    fields = {"maritalStatus": _field("متزوج"), "religion": _field("مسيحي")}
    agree_with_sex(fields, female=True)
    assert fields["maritalStatus"]["value"] == "متزوجة"
    assert fields["religion"]["value"] == "مسيحية"


def test_a_corrected_word_is_never_left_at_high():
    fields = {"maritalStatus": _field("متزوج", "high")}
    agree_with_sex(fields, female=True)
    assert fields["maritalStatus"]["confidence"] == "medium"
    assert fields["maritalStatus"]["genderCorrected"] is True


def test_a_mans_card_keeps_the_masculine_words_untouched():
    fields = {"maritalStatus": _field("أعزب"), "religion": _field("مسلم")}
    agree_with_sex(fields, female=False)
    assert fields["maritalStatus"] == _field("أعزب")
    assert fields["religion"] == _field("مسلم")


def test_a_feminine_word_on_a_mans_card_is_turned_back():
    fields = {"religion": _field("مسلمة")}
    agree_with_sex(fields, female=False)
    assert fields["religion"]["value"] == "مسلم"


def test_unknown_sex_changes_nothing():
    fields = {"maritalStatus": _field("متزوج")}
    agree_with_sex(fields, female=None)
    assert fields["maritalStatus"] == _field("متزوج")


def test_the_printed_word_decides():
    assert _holder_is_female("أنثى", None) is True
    assert _holder_is_female("ذكر", None) is False


def test_the_number_decides_when_no_word_was_read():
    assert _holder_is_female(None, {"value": FEMALE_NUMBER, "valid": True, "confidence": "high"}) is True
    assert _holder_is_female(None, {"value": MALE_NUMBER, "valid": True, "confidence": "medium"}) is False


def test_a_low_or_invalid_number_decides_nothing():
    assert _holder_is_female(None, {"value": FEMALE_NUMBER, "valid": True, "confidence": "low"}) is None
    assert _holder_is_female(None, {"value": FEMALE_NUMBER, "valid": False, "confidence": "high"}) is None


def test_word_and_number_disagreeing_decides_nothing():
    assert _holder_is_female("ذكر", {"value": FEMALE_NUMBER, "valid": True, "confidence": "high"}) is None
