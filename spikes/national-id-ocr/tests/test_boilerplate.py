"""Removing the card's own printed words, and refusing to remove anybody else's."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.boilerplate import is_boilerplate, strip_boilerplate  # noqa: E402
from nidocr.postprocess import clean_address, clean_text  # noqa: E402

#: Invented. Every piece of card text in this repository has to be.
NAME = "سلمى إبراهيم عبد الرحمن السيد"


# ── Removing the furniture ──


@pytest.mark.parametrize(
    ("read", "expected"),
    [
        (f"بطاقة تحقيق الشخصية {NAME}", NAME),
        (f"جمهورية مصر العربية {NAME}", NAME),
        (f"{NAME} جمهورية مصر العربية", NAME),
        (f"جمهورية مصر العربية بطاقة تحقيق الشخصية {NAME}", NAME),
    ],
)
def test_the_printed_header_is_removed_from_a_name(read, expected):
    assert strip_boilerplate(read) == expected


def test_the_phrase_is_matched_through_dropped_dots():
    """Same reasoning as everywhere else in this pipeline: dots are what a recognizer loses first.
    """
    assert strip_boilerplate(f"بطاقه تحقيق الشخصيه {NAME}") == NAME


def test_a_label_and_its_value_keep_the_value():
    assert strip_boilerplate("البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤") == "٢٠٢٢/٠٧/٠٤"
    assert strip_boilerplate("الديانة مسلمة") == "مسلمة"


# ── Refusing ──


def test_a_single_word_of_a_phrase_is_never_removed_on_its_own():
    """The guard that makes this safe, and the reason matching is on token sequences."""
    address = "١٢ ش الثورة - مصر الجديدة - القاهرة"
    assert strip_boilerplate(address) == address
    assert clean_address(address)[0].endswith("القاهرة")


def test_a_partial_phrase_is_left_alone():
    """Two of three words matching is a coincidence far more often than it is a truncated header."""
    assert strip_boilerplate("جمهورية مصر") == "جمهورية مصر"


def test_a_name_survives_untouched():
    assert strip_boilerplate(NAME) == NAME
    assert clean_text(NAME) == NAME


# ── Which lines carry a field at all ──


@pytest.mark.parametrize(
    "line", ["بطاقة تحقيق الشخصية", "جمهورية مصر العربية", "  الديانة  "]
)
def test_a_line_of_nothing_but_furniture_is_recognised_as_such(line):
    """These lines are dropped before anchoring, so no field box can be pulled onto them."""
    assert is_boilerplate(line)


@pytest.mark.parametrize(
    "line",
    [
        "البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤",  # a label and the expiry, the expiry is found by no other means
        "الديانة مسلمة",
        NAME,
        "٢٩٥٠٣ ١٤١٢ ٣٤٥٦٧",
    ],
)
def test_a_line_carrying_a_value_is_kept(line):
    assert not is_boilerplate(line)


def test_the_name_field_arrives_clean_even_when_the_crop_caught_the_header():
    """The end-to-end shape of the trade: a generous crop, and a value with nothing extra in it."""
    assert clean_text(f"بطاقة تحقيق الشخصية {NAME}") == NAME


# ── Broken pieces of a line read twice ──


def test_a_letter_repeating_the_next_words_start_is_dropped():
    assert "ن نصراول" not in clean_address("مدينة نصر الحى العاشر مدينه ن نصراول القاهره")[0]


def test_a_letter_repeating_the_previous_words_end_is_dropped():
    assert clean_address("٣٥٥ زهراء مدينة ة نصر")[0].startswith("٣٥٥ زهراء مدينة نصر")


def test_a_piece_ending_in_tatweel_is_dropped():
    assert "الـ" not in clean_address("مدينة نصر الحى الـ العاشر")[0]


def test_real_one_letter_words_stay():
    """ش is how the card abbreviates شارع, even next to a word that starts with ش."""
    assert "من ش شبرا" in clean_address("١ شارع المحمدى من ش شبرا القاهره")[0]


def test_an_address_word_glued_to_the_place_before_it_is_split_off():
    """'البراهمه-نجع جوده' read without its hyphen: 'البراهمهنجع جوده'."""
    assert clean_address("البراهمهنجع جوده مركز قفط قنا")[0].startswith("البراهمه نجع جوده")


def test_a_word_that_merely_contains_an_address_word_is_left_alone():
    assert clean_address("١ شارع المحمدى مركز سمسطا بنى سويف")[0] == "١ شارع المحمدى مركز سمسطا بنى سويف"
