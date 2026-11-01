"""The EGY CASH ID (formerly the employee badge): telling the fields apart by what they say."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.egycash_id import (  # noqa: E402
    badge_verdict,
    clean_employee_code,
    employee_code_valid,
    read_badge_lines,
)

NID = "29901011234567"


def _line(text: str, top: float, right: float = 900.0, width: float = 400.0, score: float = 0.95) -> dict:
    return {"text": text, "score": score, "box": (right - width, top, right, top + 40.0)}


def _value(read, name):
    return read.fields[name][0] if name in read.fields else None


def test_a_labelled_badge_is_read_by_its_labels_wherever_they_are():
    lines = [
        _line("ايجي كاش", 20),
        _line("الاسم", 120, right=900, width=120), _line("محمد احمد حسن", 120, right=760, width=300),
        _line("الوظيفة", 200, right=900, width=120), _line("مدير فرع", 200, right=760, width=300),
        _line("كود الموظف", 280, right=900, width=160), _line("0100004", 280, right=730, width=260),
        _line("الرقم القومي", 360, right=900, width=170), _line(NID, 360, right=720, width=330),
    ]
    read = read_badge_lines(lines)
    assert read.company_found
    assert _value(read, "fullNameAr") == "محمد احمد حسن"
    assert _value(read, "jobTitle") == "مدير فرع"
    assert _value(read, "employeeCode") == "0100004"
    assert _value(read, "nationalId") == NID
    assert read.labelled == {"fullNameAr", "jobTitle", "employeeCode", "nationalId"}


def test_a_label_and_its_value_in_one_line_or_on_the_next_row():
    lines = [
        _line("ايجي كاش", 20),
        _line("الاسم: كريم محمود", 120),
        _line("المسمى الوظيفي", 200), _line("محاسب", 240),  # value on the row below
        _line("كود الموظف 0100125", 320),
        _line("الرقم القومى: " + NID, 400),
    ]
    read = read_badge_lines(lines)
    assert _value(read, "fullNameAr") == "كريم محمود"
    assert _value(read, "jobTitle") == "محاسب"
    assert _value(read, "employeeCode") == "0100125"
    assert _value(read, "nationalId") == NID


def test_an_unlabelled_badge_is_told_apart_by_what_each_line_says():
    lines = [
        _line("إيجي كاش", 20),
        _line("محمد احمد حسن", 140),
        _line("محاسب", 210),
        _line("0100004", 300),
        _line(NID, 380),
    ]
    read = read_badge_lines(lines)
    assert read.company_found
    assert _value(read, "fullNameAr") == "محمد احمد حسن"
    assert _value(read, "jobTitle") == "محاسب"
    assert _value(read, "employeeCode") == "0100004"
    assert _value(read, "nationalId") == NID
    assert read.labelled == set()


def test_the_companys_logo_wording_is_found_in_english_however_it_was_split_or_misread():
    for printed in ("EGY CASH", "EGYCASH", "Egy Cash", "EGY CASM", "EGYCASH TECHNOLOGICAL CASH SOLUTIONS"):
        read = read_badge_lines([_line(printed, 20), _line("احمد حسن", 100)])
        assert read.company_found, printed
        assert read.fields["companyName"][0] == "EGY CASH", printed  # written the same whichever way found
    # The tagline alone is the logo too.
    assert read_badge_lines([_line("TECHNOLOGICAL CASH SOLUTIONS", 60)]).company_found
    # Other companies, and other words with CASH in them, are not.
    assert not read_badge_lines([_line("CASH PLUS", 20)]).company_found
    assert not read_badge_lines([_line("EGYPT AIR", 20)]).company_found


def test_the_companys_name_is_found_with_a_letter_misread_and_not_found_when_absent():
    assert read_badge_lines([_line("ايجى كاش", 20), _line("احمد حسن", 100)]).company_found
    assert read_badge_lines([_line("ايجي كاس", 20)]).company_found
    assert not read_badge_lines([_line("بنك مصر", 20), _line("احمد حسن", 100)]).company_found


def test_a_nine_digit_number_is_not_taken_for_the_national_id_nor_a_date_for_the_code():
    read = read_badge_lines([_line("ايجي كاش", 20), _line("0100004", 100), _line(NID, 180), _line("2026/12/25", 260)])
    assert _value(read, "employeeCode") == "0100004"
    assert _value(read, "nationalId") == NID


def test_the_employee_code_is_the_branch_code_and_the_number():
    assert employee_code_valid("0100004")
    assert employee_code_valid("01000125")
    assert not employee_code_valid("10004")  # too short for branch code + number
    assert not employee_code_valid("01A0004")
    assert clean_employee_code("٠١٠٠٠٠٤") == ("0100004", True)  # Indic numerals are folded


def test_the_verdict_needs_the_company_and_a_code_or_a_number():
    assert badge_verdict(True, True, False) == "egycash_badge"
    assert badge_verdict(True, False, True) == "egycash_badge"
    assert badge_verdict(False, False, False) == "not_egycash_badge"
    assert badge_verdict(False, False, True) == "not_egycash_badge"  # a national ID card
    assert badge_verdict(True, False, False) == "unsure"
    assert badge_verdict(False, True, True) == "unsure"


def test_speckle_read_between_the_words_of_a_name_does_not_spoil_the_row():
    lines = [
        _line("ايجي كاش", 20),
        _line("حازم عادل", 140, right=900, width=300), _line("lw", 150, right=700, width=30, score=0.37),
        _line("منصور", 140, right=640, width=180),
        _line("أمين خزينة", 230),
        _line("0107731", 320), _line(NID, 400),
    ]
    read = read_badge_lines(lines)
    assert _value(read, "fullNameAr") == "حازم عادل منصور"
    assert _value(read, "jobTitle") == "أمين خزينة"


def test_a_label_split_into_a_box_per_word_is_still_a_label():
    lines = [
        _line("ايجي كاش", 20),
        _line("كود", 120, right=900, width=100), _line("الموظف", 120, right=790, width=150), _line("0100004", 120, right=620, width=250),
        _line("الرقم", 220, right=900, width=120), _line("القومي", 220, right=770, width=140), _line(NID, 220, right=620, width=330),
    ]
    read = read_badge_lines(lines)
    assert _value(read, "employeeCode") == "0100004"
    assert _value(read, "nationalId") == NID
    assert read.labelled == {"employeeCode", "nationalId"}


# The detector can cut a code's row short: on a real badge the box held the label "كود الموظف" and
# only the first two of its seven digits; the rest, further left, were never read. The re-read
# widens the strip to where the national ID number's row starts (the two are printed in one column),
# and no further: the signature block sits at the same height further left.
def test_a_cut_short_code_row_is_widened_to_the_national_id_rows_start():
    from nidocr.egycash_id import widen_code_box

    code = (917.0, 473.0, 1461.0, 520.0)
    national = (665.0, 550.0, 1468.0, 600.0)
    left, top, right, bottom = widen_code_box(code, national, width=1600)
    assert left <= 665.0 and left >= 640.0  # to the number row's start, a small margin, not beyond
    assert (top, right, bottom) == (473.0, 1461.0, 520.0)


def test_without_a_national_id_row_the_strip_reaches_a_share_of_the_badge():
    from nidocr.egycash_id import widen_code_box

    left, *_ = widen_code_box((917.0, 473.0, 1461.0, 520.0), None, width=1600)
    assert 400.0 <= left < 917.0


def test_a_code_box_already_wider_than_the_number_row_is_kept():
    from nidocr.egycash_id import widen_code_box

    assert widen_code_box((600.0, 473.0, 1461.0, 520.0), (665.0, 550.0, 1468.0, 600.0), width=1600)[0] == 600.0


def test_the_strip_stops_at_the_next_thing_printed_on_the_row():
    # The signature's caption sits at the code's height, further left: the strip ends just past it,
    # so its words are not read as part of the code.
    from nidocr.egycash_id import widen_code_box

    left, *_ = widen_code_box((917.0, 473.0, 1461.0, 520.0), None, width=1600,
                              neighbours=[(175.0, 458.0, 606.0, 505.0), (665.0, 550.0, 1468.0, 600.0)])
    assert 606.0 < left <= 640.0
