"""Dot-tolerant Arabic matching, and the places it must refuse to help.

Arabic letters are a small set of skeletons plus dots: ب ت ث ن ي are one shape with different
dotting, and so are ج ح خ, د ذ, ر ز, س ش, ص ض, ط ظ, ع غ, ف ق. Dots are the smallest marks on the
card, and they are the first thing a JPEG artefact swallows or a reflection erases. A recognizer
that reads مسلمه for مسلمة got the shape exactly right and one dot wrong — and plain string
comparison scores that as a miss, so a reviewer retypes a field the model effectively got right.

Folding to the skeleton ignores exactly the information that was destroyed. But it also
deliberately conflates real, distinct words, so it is only safe against a closed vocabulary whose
members are known not to collide — and half of these tests are about where that stops being true.
"""

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
    """The one property that makes rasm folding safe for these vocabularies.

    ة folds onto ه rather than being deleted, so مسلم and مسلمة stay distinct. Were the ending
    dropped, every masculine/feminine pair would collapse and the fold would be silently choosing
    someone's marital status for them.
    """
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
    """The safety precondition for the whole approach, asserted rather than assumed.

    If two terms ever folded together, snapping between them would become a coin flip that looks
    like a correction. This is here so that adding a term later cannot quietly introduce one.
    """
    for vocabulary in (
        ("مسلم", "مسلمة", "مسيحي", "مسيحية"),
        ("أعزب", "عزباء", "متزوج", "متزوجة", "مطلق", "مطلقة", "أرمل", "أرملة"),
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
    """البحيرة and الجيزة are one edit apart once dotting is folded away.

    They are also three hundred kilometres apart, so snapping a near-miss to either is a coin flip
    dressed as a correction. Requiring a unique match does not save this — a read one edit from
    Beheira and two from Giza is 'unique' and still a guess — so names with a close relative accept
    only exact or rasm-exact matches.
    """
    from nidocr.governorates import _FUZZY_ELIGIBLE

    assert levenshtein(rasm_fold("البحيرة"), rasm_fold("الجيزة"), limit=2) <= 1
    eligible = set(_FUZZY_ELIGIBLE.values())
    assert "البحيرة" not in eligible and "الجيزة" not in eligible
    assert "مطروح" in eligible, "a name with no close relative can still absorb a dropped letter"

    # Exact and rasm-exact matching still resolve both — the fold keeps them one edit apart, so
    # only the approximate pass was ever at risk of confusing them.
    assert match_governorate("البحيرة") == "البحيرة"
    assert match_governorate("الجيزة") == "الجيزة"
    assert match_governorate("الجيزه") == "الجيزة"


def test_a_word_that_is_not_a_governorate_matches_nothing():
    assert match_governorate("المنصورة") is None  # a city, not a governorate
    assert match_governorate("") is None


def test_only_the_address_tail_is_rewritten():
    """Street and district are free text with nothing to check them against.

    Correcting the governorate is repair; rewriting the rest would be invention.
    """
    address, snapped = snap_address_tail("٣٤ ش الجمهورية المنصورة أول - الدقهلىه")
    assert snapped
    assert address.endswith("الدقهلية")
    assert "٣٤ ش الجمهورية المنصورة أول" in address, "the head must survive untouched"


def test_an_address_with_no_recognisable_governorate_is_untouched():
    original = "١٢ شارع مجهول - مكان ما"
    address, snapped = clean_address(original)
    assert not snapped and address == original


def test_the_governorate_table_matches_the_contract_codes():
    """Kept in step with `EGYPT_GOVERNORATE_CODES` in the contracts package.

    28 entries, not 27: Egypt has 27 governorates, and code 88 is the separate 'born abroad'
    marker that the same field carries.
    """
    assert len(GOVERNORATES_AR) == 28
    assert set(GOVERNORATES_AR) >= {"01", "12", "21", "88"}
    assert all(normalize_arabic(name) for name in GOVERNORATES_AR.values())
