"""Dot-tolerant Arabic matching, and the places it must refuse to help."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.arabic import levenshtein, normalize_arabic, rasm_fold  # noqa: E402
from nidocr.governorates import (  # noqa: E402
    GOVERNORATES_AR,
    match_governorate,
    snap_address_tail,
)
from nidocr.postprocess import clean_address, clean_marital_status, clean_religion  # noqa: E402

# ── The fold itself ──


def test_dotting_differences_fold_together():
    assert rasm_fold("ب") == rasm_fold("ت") == rasm_fold("ن")
    assert rasm_fold("ج") == rasm_fold("خ")
    assert rasm_fold("ر") == rasm_fold("ز")


def test_the_feminine_ending_survives_the_fold():
    """The one property that makes rasm folding safe for these vocabularies."""
    assert rasm_fold("مسلم") != rasm_fold("مسلمة")
    assert rasm_fold("متزوج") != rasm_fold("متزوجة")
    assert rasm_fold("مسلمة") == rasm_fold("مسلمه")


def test_levenshtein_abandons_hopeless_comparisons():
    assert levenshtein("مسلم", "مسلم") == 0
    assert levenshtein("مسلم", "مسلمة", limit=2) == 1
    assert levenshtein("القاهرة", "أسوان", limit=2) > 2


# ── Closed vocabularies ──


@pytest.mark.parametrize(
    ("read", "expected"),
    [
        ("مسلمة", "مسلمة"),
        ("مسلمه", "مسلمة"),  # ta marbuta written plain
        ("مسيحى", "مسيحي"),  # alef maqsura for ya
        ("مسلم", "مسلم"),
    ],
)
def test_religion_snaps_through_orthographic_noise(read, expected):
    value, snapped = clean_religion(read)
    assert value == expected and snapped


@pytest.mark.parametrize(
    ("read", "expected"),
    [("متزوجة", "متزوجة"), ("متزوجه", "متزوجة"), ("مطلق", "مطلق"), ("أرملة", "أرملة")],
)
def test_marital_status_snaps_through_orthographic_noise(read, expected):
    value, snapped = clean_marital_status(read)
    assert value == expected and snapped


def test_a_word_outside_the_vocabulary_is_left_alone():
    """Rough text a reviewer re-reads beats a confident wrong value they wave through."""
    value, snapped = clean_religion("مهندس")
    assert not snapped and value == "مهندس"


def test_no_two_vocabulary_terms_share_a_skeleton():
    """The safety precondition for the whole approach, asserted rather than assumed."""
    for vocabulary in (
        ("مسلم", "مسلمة", "مسيحي", "مسيحية"),
        ("أعزب", "عزباء", "متزوج", "متزوجة", "مطلق", "مطلقة", "أرمل", "أرملة", "آنسة"),
    ):
        folded = [rasm_fold(term) for term in vocabulary]
        assert len(set(folded)) == len(folded)


# ── Governorates ──


@pytest.mark.parametrize(
    ("read", "expected"),
    [
        ("الدقهلية", "الدقهلية"),
        ("الدقهليه", "الدقهلية"),
        ("الدقهلىه", "الدقهلية"),
        ("القاهره", "القاهرة"),
        ("كفرالشيخ", "كفر الشيخ"),
        ("بنى سويف", "بني سويف"),
    ],
)
def test_governorate_names_survive_ordinary_misreads(read, expected):
    assert match_governorate(read) == expected


def test_confusable_governorates_refuse_approximate_matching():
    """البحيرة and الجيزة are one edit apart once dotting is folded away."""
    from nidocr.governorates import _FUZZY_ELIGIBLE

    assert levenshtein(rasm_fold("البحيرة"), rasm_fold("الجيزة"), limit=2) <= 1
    eligible = set(_FUZZY_ELIGIBLE.values())
    assert "البحيرة" not in eligible and "الجيزة" not in eligible
    assert "مطروح" in eligible, "a name with no close relative can still absorb a dropped letter"

    # Exact and rasm-exact matching still resolve both, the fold keeps them one edit apart, so
    # only the approximate pass was ever at risk of confusing them.
    assert match_governorate("البحيرة") == "البحيرة"
    assert match_governorate("الجيزة") == "الجيزة"
    assert match_governorate("الجيزه") == "الجيزة"


def test_a_word_that_is_not_a_governorate_matches_nothing():
    assert match_governorate("المنصورة") is None  # a city, not a governorate
    assert match_governorate("") is None


def test_only_the_address_tail_is_rewritten():
    """Street and district are free text with nothing to check them against."""
    address, snapped = snap_address_tail("٣٤ ش الجمهورية المنصورة أول - الدقهلىه")
    assert snapped
    assert address.endswith("الدقهلية")
    assert "٣٤ ش الجمهورية المنصورة أول" in address, "the head must survive untouched"


def test_an_address_with_no_recognisable_governorate_is_untouched():
    original = "١٢ شارع مجهول - مكان ما"
    address, snapped = clean_address(original)
    assert not snapped and address == original


def test_the_governorate_table_matches_the_contract_codes():
    """Kept in step with `EGYPT_GOVERNORATE_CODES` in the contracts package."""
    assert len(GOVERNORATES_AR) == 28
    assert set(GOVERNORATES_AR) >= {"01", "12", "21", "88"}
    assert all(normalize_arabic(name) for name in GOVERNORATES_AR.values())


# ── The sex on the row settles the gender of the other two fields ──


@pytest.mark.parametrize(
    ("row", "religion", "marital"),
    [
        ("أنثى مسلمة متزوجة", "مسلمة", "متزوجة"),  # read cleanly
        ("أنثى مسلمة متزوج", "مسلمة", "متزوجة"),  # the ة dropped from marital
        ("أنثى مسلم متزوج", "مسلمة", "متزوجة"),  # dropped from both
        ("ذكر مسلم متزوج", "مسلم", "متزوج"),
        ("أنثى مسلمة أعزب", "مسلمة", "عزباء"),  # not a suffix rule, a different word
    ],
)
def test_the_row_corrects_a_dropped_feminine_ending(row, religion, marital):
    """The failure this catches is silent, which is what makes it worth catching."""
    assert clean_religion(row)[0] == religion
    assert clean_marital_status(row)[0] == marital


@pytest.mark.parametrize("read", ["آنسة", "آنسه", "انسة", "انسه", "أنسة"])
def test_an_unmarried_womans_card_prints_anisa_and_it_is_kept(read):
    """Cards print 'آنسة' for an unmarried woman where a man's say 'أعزب'; it was not a known word,
    so it came back as raw text the form could not place."""
    assert clean_marital_status(read)[0] == "آنسة"
    assert clean_marital_status("أنثى مسلمة " + read)[0] == "آنسة"


def test_without_a_sex_word_the_read_is_left_exactly_as_found():
    """The correction is licensed by the row stating a sex. No sex, no licence."""
    assert clean_marital_status("متزوج") == ("متزوج", True)
    assert clean_marital_status("مطلقة") == ("مطلقة", True)
    assert clean_religion("مسلم") == ("مسلم", True)
