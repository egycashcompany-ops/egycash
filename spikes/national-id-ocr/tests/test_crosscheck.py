"""Cross-field checks: each only lowers confidence, and only when the card contradicts itself."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.crosscheck import cross_check  # noqa: E402
from nidocr.rows import _issue_year  # noqa: E402

TODAY = dt.date(2026, 10, 11)
ID_2003 = "30307250100015"  # made up; born 2003-07-25


def _fields(expiry="2026-12-25", number=ID_2003):
    return {
        "nationalIdExpiry": {"value": expiry, "confidence": "high"},
        "nationalId": {"value": number, "confidence": "high"},
    }


def test_a_consistent_card_fails_nothing_and_keeps_its_confidence():
    fields = _fields()
    assert cross_check(fields, 2019, today=TODAY) == []
    assert {f["confidence"] for f in fields.values()} == {"high"}


def test_an_expiry_that_does_not_match_a_seven_year_validity_is_flagged():
    fields = _fields(expiry="2030-12-25")
    assert "validityPeriod" in cross_check(fields, 2019, today=TODAY)
    assert fields["nationalIdExpiry"]["confidence"] == "medium"


def test_an_expiry_before_the_issue_date_is_low():
    fields = _fields(expiry="2016-12-25")
    assert "expiryBeforeIssue" in cross_check(fields, 2019, today=TODAY)
    assert fields["nationalIdExpiry"]["confidence"] == "low"


def test_a_birth_date_that_makes_the_holder_a_child_at_issue_demotes_the_number():
    fields = _fields(number="31207250100015")  # born 2012
    assert "tooYoungAtIssue" in cross_check(fields, 2019, today=TODAY)
    assert fields["nationalId"]["confidence"] == "low"


def test_a_misread_issue_year_is_ignored_rather_than_trusted():
    fields = _fields()
    assert cross_check(fields, 2091, today=TODAY) == []


def test_the_issue_year_is_taken_from_the_date_piece_even_with_its_slash_misread():
    row = [{"text": "٢٠١٩١٧", "score": 0.9, "box": (0, 0, 1, 1)},
           {"text": "٣٠٣٠٧٢٥٠١٠٠٠١٥", "score": 0.9, "box": (2, 0, 3, 1)}]
    assert _issue_year(row) == 2019
