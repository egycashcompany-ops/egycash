"""Word-list correction: only dot-level misreads and one look-alike letter, only when unambiguous."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import _finalize  # noqa: E402
from nidocr.lexicon import correct  # noqa: E402


def test_a_lost_dot_is_restored_from_the_one_word_with_that_shape():
    assert correct("خماد", "name") == ("حماد", True)
    assert correct("اإيراهيم", "name")[0] in ("اإيراهيم", "ابراهيم")  # unknown prefix: not forced


def test_a_compound_name_with_a_misread_letter_is_restored():
    assert correct("جيدالحميد", "name") == ("عبدالحميد", True)
    assert correct("عيدالرحمن", "name") == ("عبدالرحمن", True)


def test_ha_read_as_ain_is_corrected_in_an_address():
    assert correct("ش المعروسة", "address") == ("ش المحروسة", True)


def test_a_known_word_is_never_touched():
    assert correct("محمد حسن", "name") == ("محمد حسن", False)


def test_an_unknown_name_is_left_exactly_as_read():
    assert correct("زوربا", "name") == ("زوربا", False)


def test_a_corrected_name_is_never_high():
    field = _finalize("fullNameAr", "حسام خماد", 0.99)
    assert field["value"] == "حسام حماد"
    assert field["confidence"] == "medium"


def test_an_uncorrected_name_keeps_its_confidence():
    assert _finalize("fullNameAr", "حسام حماد", 0.99)["confidence"] == "high"


def test_a_name_is_never_changed_by_a_look_alike_letter_only_by_its_dots():
    assert correct("زيدان", "name") == ("زيدان", False)  # 'رندان'-style shape swaps are not tried
    assert correct("بدوى", "name")[0] == "بدوى"
