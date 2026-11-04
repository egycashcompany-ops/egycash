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


def test_a_tooth_letter_added_by_the_ocr_is_removed_from_a_district():
    assert correct("مركز سمسيطا", "address") == ("مركز سمسطا", True)


def test_a_name_never_loses_or_gains_a_letter():
    assert correct("سمسيطا", "name") == ("سمسيطا", False)


def test_a_word_final_ya_is_never_dropped_as_a_stray_tooth():
    assert correct("شارع المحمدى", "address") == ("شارع المحمدى", False)


def test_a_name_split_at_the_cards_printed_gap_is_rejoined():
    from nidocr.lexicon import correct

    assert correct("هد ى احمد حامد احمد", "name")[0] == "هدى احمد حامد احمد"
    # Two real names side by side are two names, not one.
    assert correct("علي حسن", "name")[0] == "علي حسن"


def test_a_vowel_mark_the_recognizer_added_is_dropped_from_a_name():
    assert correct("علْى عبدالمنعم", "name")[0] == "على عبدالمنعم"


# ── Two blur misreads seen on a live phone photo of a real card ──────────────────────────────────
from nidocr.lexicon import correct as _correct_name  # noqa: E402


def test_an_extra_lam_after_the_opening_alef_is_dropped_when_that_leaves_a_name():
    """'اشرف' came back 'الشرف': the alef's foot and the gap after it read as a lam."""
    assert _correct_name("الشرف", "name")[0] == "اشرف"


def test_a_sad_read_for_a_seen_is_put_right_when_one_name_fits():
    """'فارس' came back 'قارص': the seen's teeth filled in on a soft photo and read as a sad."""
    assert _correct_name("قارص", "name")[0] == "فارس"


def test_names_that_really_have_a_sad_or_an_article_are_left_alone():
    for name in ("صابر", "صالح", "صبحي", "صلاح", "الشافعي", "الجندي", "السيد", "الحديدى", "خليل", "عدلي", "فالح"):
        assert _correct_name(name, "name")[0] == name, name


def test_the_two_misreads_of_muhammad_seen_live_are_put_right():
    """The commonest name, its middle meem lost ('محد') or read as a sad ('محصد') on a soft photo.
    Neither is a name, and a looser rule (one letter from any name) changed real names."""
    assert _correct_name("حسن علي محد سالم محصد", "name")[0] == "حسن علي محمد سالم محمد"


def test_a_real_name_near_muhammad_is_left_alone():
    for name in ("مجدي", "مجد", "حمد", "محمود", "محمد"):
        assert _correct_name(name, "name")[0] == name, name
