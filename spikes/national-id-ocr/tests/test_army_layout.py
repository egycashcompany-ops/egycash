"""The certificate's table: labels in a header row, each value in the row below, in its column.

Every value here is made up. The line boxes copy the SHAPE measured on the first real sample
(where each label sat, where its value sat), never its text.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.army_exemption import load_profile, read_exemption_page  # noqa: E402

TODAY = date(2026, 10, 15)
NID = "29503141234567"  # made up, structurally valid: 1995-03-14


def line(text, left, top, right, bottom=None, score=0.9):
    return {"text": text, "score": score, "box": [left, top, right, bottom if bottom is not None else top + 30]}


def certificate(**override):
    """A made-up certificate laid out like the real one (x grows to the right; Arabic reads right to left)."""
    lines = {
        "ministry": line("وزارة الدفاع", 943, 99, 1116),
        "title": line("شهادة بالإعفاء النهائي", 546, 208, 759),
        "name": line("الاسم واللقب: محمد احمد علي حسن", 703, 348, 1081),
        "birthLabel": line("تاريخ الميلاد", 479, 351, 587),
        "birth": line("1995/03/14", 278, 352, 413),
        "milLabel": line("رقم البطاقة العسكرية", 897, 397, 1064),
        "nidLabel": line("الرقم القومي وجهة صدوره", 636, 403, 831),
        "codeLabel": line("كود القرار", 506, 400, 582),
        "numLabel": line("رقم القرار", 397, 406, 492),
        "dateLabel": line("تاريخ القرار", 252, 406, 354),
        "mil": line("1995 12 3456", 874, 445, 1065),
        "nid": line(NID, 601, 449, 799),
        "code": line("2", 524, 452, 537),
        # The detector joined the decision's number and date into one box, as on the real sample.
        "numDate": line("12345 2013/07/20", 233, 449, 472),
        "decision": line("اعفاء المذكور نهائيا من اداء الخدمة العسكرية", 760, 522, 1087),
        "issueLabel": line("تاريخ تحرير الشهادة", 958, 770, 1109),
        "issue": line("2014/01/05", 851, 790, 951),
    }
    for key, value in override.items():
        if value is None:
            lines.pop(key)
        else:
            lines[key] = value
    return list(lines.values())


PROFILE = load_profile(ROOT / "profiles" / "documents" / "army-exemption.json")


def fields_of(read):
    return {name: data["value"] for name, data in read.fields.items()}


def test_the_measured_profile_is_configured():
    assert PROFILE.configured


def test_each_value_is_taken_from_the_column_under_its_label():
    got = fields_of(read_exemption_page(certificate(), PROFILE, today=TODAY))
    assert got["nationalId"] == NID
    assert got["militaryNumber"] == "1995123456"
    assert got["decisionCode"] == "2"


def test_a_number_and_a_date_joined_in_one_box_are_split():
    got = fields_of(read_exemption_page(certificate(), PROFILE, today=TODAY))
    assert got["decisionNumber"] == "12345"
    assert got["decisionDate"] == "2013-07-20"


def test_inline_fields_read_the_value_beside_their_label():
    got = fields_of(read_exemption_page(certificate(), PROFILE, today=TODAY))
    assert got["fullNameAr"] == "محمد احمد علي حسن"
    assert got["birthDate"] == "1995-03-14"
    assert got["issueDate"] == "2014-01-05"


def test_the_decision_and_the_kind_of_exemption_are_read():
    read = read_exemption_page(certificate(), PROFILE, today=TODAY)
    assert "الخدمة" in read.fields["decision"]["value"]
    assert read.fields["exemptionType"]["value"] == "نهائي"


def test_a_consistent_certificate_matches_and_no_field_is_high():
    read = read_exemption_page(certificate(), PROFILE, today=TODAY)
    assert read.verdict.status == "match", read.verdict.reasons
    assert all(data["confidence"] != "high" for data in read.fields.values())


def test_a_birth_date_that_disagrees_with_the_national_id_is_reported():
    read = read_exemption_page(certificate(birth=line("1996/03/14", 278, 352, 413)), PROFILE, today=TODAY)
    assert "birth_date_disagrees_with_national_id" in read.verdict.reasons
    assert read.verdict.status == "unreadable"


def test_a_decision_dated_before_the_holder_was_born_is_reported():
    read = read_exemption_page(certificate(numDate=line("12345 1990/07/20", 233, 449, 472)), PROFILE, today=TODAY)
    assert "dates_out_of_order" in read.verdict.reasons


def test_without_its_national_id_number_it_is_not_a_match():
    read = read_exemption_page(certificate(nid=None), PROFILE, today=TODAY)
    assert read.verdict.status == "unreadable"
    assert "nationalId_missing" in read.verdict.reasons


def test_a_national_id_card_is_still_refused():
    lines = [line("جمهورية مصر العربية", 600, 50, 1000), line("بطاقة تحقيق الشخصية", 600, 90, 1000),
             line("محمد احمد", 600, 200, 1000), line(NID, 600, 400, 1000)]
    read = read_exemption_page(lines, PROFILE, today=TODAY)
    assert read.verdict.status == "not_match"
    assert read.verdict.reasons == ("looks_like_national_id",)


def test_holder_disagreement_is_still_checked():
    read = read_exemption_page(certificate(), PROFILE, today=TODAY,
                               holder={"nationalId": "29001011234567", "fullNameAr": "محمد احمد علي حسن"})
    assert "national_id_disagrees_with_card" in read.verdict.reasons


def test_the_wording_of_the_kind_never_claims_authenticity():
    read = read_exemption_page(certificate(), PROFILE, today=TODAY)
    text = " ".join(str(data["value"]) for data in read.fields.values()).lower()
    assert "genuine" not in text and "authentic" not in text


# Measured on the real sample: the certificate's "/" is read as the digit 1, or dropped.
def test_a_date_whose_slashes_were_read_as_ones_is_still_a_date():
    from nidocr.army_exemption import _parse_date

    assert _parse_date("1995103114").isoformat() == "1995-03-14"   # 1995/03/14, both slashes as 1
    assert _parse_date("201310720").isoformat() == "2013-07-20"    # 2013/07/20, one as 1, one lost
    assert _parse_date("20140105").isoformat() == "2014-01-05"     # both lost
    assert _parse_date("12345") is None


def test_the_name_is_found_beside_the_birth_date_when_its_label_was_not_read():
    lines = certificate(name=line("محمد احمد علي حسن", 703, 348, 1081))  # the label itself was lost
    got = fields_of(read_exemption_page(lines, PROFILE, today=TODAY))
    assert got["fullNameAr"] == "محمد احمد علي حسن"


def test_a_closer_read_that_agrees_with_the_birth_date_wins():
    misread = "29503151234567"  # one digit off: 1995-03-15, the certificate says 1995-03-14
    lines = certificate(nid=line(misread, 601, 449, 799))

    def reread(box, kind):
        return NID if kind == "nationalId" else None

    read = read_exemption_page(lines, PROFILE, today=TODAY, reread=reread)
    assert read.fields["nationalId"]["value"] == NID
    assert read.verdict.status == "match", read.verdict.reasons


def test_without_a_better_read_the_disagreement_is_reported():
    read = read_exemption_page(certificate(nid=line("29503151234567", 601, 449, 799)), PROFILE, today=TODAY)
    assert "birth_date_disagrees_with_national_id" in read.verdict.reasons


def test_a_name_with_a_one_letter_word_is_flagged_low():
    # Measured on the real sample: a blurred name came back with a lone letter in it. Arabic names
    # have no one-letter words, so the read is noise and a person must check it.
    lines = certificate(name=line("الاسم واللقب: محمد احمد ع حسن", 703, 348, 1081))
    read = read_exemption_page(lines, PROFILE, today=TODAY)
    assert read.fields["fullNameAr"]["confidence"] == "low"


def test_two_reads_of_the_national_id_that_disagree_are_flagged_low():
    # A digit outside the birth date (the 13th) misread: the birth check cannot see it, a second
    # read can. Neither read is chosen silently: the number is shown low, for a person to check.
    def reread(box, kind):
        return "29503141234577" if kind == "nationalId" else None

    read = read_exemption_page(certificate(), PROFILE, today=TODAY, reread=reread)
    assert read.fields["nationalId"]["confidence"] == "low"
    assert read.fields["nationalId"]["readsDisagree"] is True


def test_two_reads_that_agree_stay_medium():
    read = read_exemption_page(certificate(), PROFILE, today=TODAY, reread=lambda box, kind: NID if kind == "nationalId" else None)
    assert read.fields["nationalId"]["confidence"] == "medium"


def test_a_required_field_read_too_poorly_is_not_a_clean_match():
    lines = certificate(name=line("الاسم واللقب: محمد احمد ع حسن", 703, 348, 1081))
    read = read_exemption_page(lines, PROFILE, today=TODAY)
    assert read.verdict.status == "unreadable"
    assert "fullNameAr_unclear" in read.verdict.reasons


# The second real sample (2026-10-15, a sharp photo): the same form, measured again. Its table's
# cells are wider than their labels, so a value need not sit under its label's own words.
def second_sample(**override):
    lines = {
        "ministry": line("وزارة الدفاع", 1497, 0, 1873, 109),
        "title": line("شهادة بالإعفاء المؤقت", 728, 261, 1116, 331),
        "name": line("الإسم واللقب", 1548, 529, 1803, 590),
        "nameValue": line("محمد احمد علي حسن", 973, 525, 1495, 598),
        "birthLabel": line("تاريخ الميلاد", 584, 554, 756, 602),
        "birth": line("1995/03/14", 252, 542, 458, 594),
        "milLabel": line("رقم البطاقة العسكرية", 1400, 618, 1767, 665),
        "nidLabel": line("الرقم القومى وجهة صدوره", 858, 632, 1232, 685),
        # "كود القرار" printed on two lines: the cell is far wider than the short word "كود".
        "codeLabel": line("كود", 661, 628, 731, 672),
        "codeLabel2": line("القرار", 641, 654, 738, 709),
        "numLabel": line("رقم القرار", 427, 639, 568, 691),
        "dateLabel": line("تاريخ القرار", 185, 640, 340, 692),
        "mil2": line("الثلاثى جهة صدورها", 1401, 656, 1761, 704),
        "mil": line("1995 123 456", 1390, 719, 1776, 769),
        "nid": line(NID, 793, 713, 1166, 761),
        # The code's one digit sits left of its label, in the same cell.
        "code": line("4", 641, 719, 667, 750, score=0.65),
        "num": line("6789", 430, 711, 538, 755),
        "date": line("2016/02/21", 150, 708, 358, 757),
    }
    for key, value in override.items():
        if value is None:
            lines.pop(key)
        else:
            lines[key] = value
    return list(lines.values())


def test_a_value_anywhere_in_its_labels_cell_is_taken():
    got = fields_of(read_exemption_page(second_sample(), PROFILE, today=TODAY))
    assert got["decisionCode"] == "4"
    assert got["militaryNumber"] == "1995123456"
    assert got["decisionNumber"] == "6789"
    assert got["nationalId"] == NID


def test_a_date_with_one_slash_lost_is_still_a_date():
    from nidocr.army_exemption import _parse_date

    assert _parse_date("201602/21").isoformat() == "2016-02-21"   # measured: the first "/" lost
    assert _parse_date("2016/0221").isoformat() == "2016-02-21"
    got = fields_of(read_exemption_page(second_sample(date=line("201602/21", 150, 708, 358, 757)), PROFILE, today=TODAY))
    assert got["decisionDate"] == "2016-02-21"


def test_a_closer_read_of_a_number_that_disagrees_does_not_replace_it():
    # Measured: the closer read of the military card's spaced groups once came back with 12 wrong
    # digits. A longer read is not a better one: the first stays, shown low, for a person to check.
    def reread(box, kind):
        return "199501234567" if kind in ("digits", "groups") and box[0] > 1300 else None

    read = read_exemption_page(second_sample(), PROFILE, today=TODAY, reread=reread)
    assert read.fields["militaryNumber"]["value"] == "1995123456"
    assert read.fields["militaryNumber"]["confidence"] == "low"
    assert read.fields["militaryNumber"]["readsDisagree"] is True


def test_a_closer_read_that_only_adds_lost_digits_is_taken():
    lines = second_sample(num=line("678", 430, 711, 538, 755))  # a digit lost at the edge

    def reread(box, kind):
        return "6789" if kind == "digits" and 400 < box[0] < 560 else None

    read = read_exemption_page(lines, PROFILE, today=TODAY, reread=reread)
    assert read.fields["decisionNumber"]["value"] == "6789"


def test_two_reads_of_a_number_that_agree_stay_medium():
    read = read_exemption_page(second_sample(), PROFILE, today=TODAY,
                               reread=lambda box, kind: "1995123456" if box[0] > 1300 else None)
    assert read.fields["militaryNumber"]["confidence"] == "medium"
    assert "readsDisagree" not in read.fields["militaryNumber"]


def test_the_second_sample_is_temporary_and_matches():
    read = read_exemption_page(second_sample(), PROFILE, today=TODAY)
    assert read.fields["exemptionType"]["value"] == "مؤقت"
    assert read.verdict.status == "match", read.verdict.reasons
