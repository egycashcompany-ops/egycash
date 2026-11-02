"""A name word one letter away from a common name is a likely misread: never left at 'high'."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import _finalize  # noqa: E402
from nidocr.lexicon import near_miss  # noqa: E402


def test_a_dropped_letter_in_a_common_given_name_is_a_near_miss():
    assert near_miss("محد احمد علي", "name")  # محمد with its م lost


def test_a_correct_name_is_not():
    assert not near_miss("محمد احمد علي", "name")


def test_a_family_name_the_lexicon_does_not_know_is_not_a_near_miss():
    # Far from every listed name: unknown is not suspicious, only "almost a known one" is.
    assert not near_miss("محمد الشربيني", "name")


def test_short_words_are_ignored():
    assert not near_miss("ال بن", "name")


def test_a_high_score_near_miss_name_is_capped_at_medium():
    data = _finalize("fullNameAr", "محمو احمد علي", 0.95)  # محمود with its د lost
    assert data["confidence"] == "medium"
    assert data.get("nearLexicon") is True


def test_a_corrected_name_is_never_presented_as_certainly_read():
    data = _finalize("fullNameAr", "محد احمد علي", 0.95)
    assert data["value"] == "محمد احمد علي"
    assert data["confidence"] == "medium"


def test_a_high_score_known_name_stays_high():
    assert _finalize("fullNameAr", "محمد احمد علي", 0.95)["confidence"] == "high"


def test_a_short_word_two_edits_from_a_common_name_is_a_near_miss():
    # A real card's three-letter given name came back two edits off and scored 0.915 (G4).
    # In a short word a lost letter changes most of it, so two edits still look like a misread.
    assert near_miss("حكد احمد علي", "name")


def test_a_long_unknown_word_two_edits_away_is_still_not():
    assert not near_miss("محمد الشربيني", "name")


def test_a_short_listed_name_is_fine():
    assert not near_miss("زيد احمد علي", "name")
