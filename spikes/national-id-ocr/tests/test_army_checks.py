"""The third real sample's layout (a worn, laminated FINAL exemption), the fields the user marked on
it, and the consistency checks that catch a certificate whose parts contradict each other.

Every value here is made up. The line boxes copy the SHAPE measured on the sample, never its text.
A check passing is never proof a certificate is genuine: only the issuing authority can say that.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.army_exemption import classify_reason, load_profile, read_exemption_page  # noqa: E402

TODAY = date(2026, 10, 15)
NID = "29503141234567"  # made up, structurally valid: born 1995-03-14, governorate 12 (الدقهلية)
NAME = "محمد احمد علي حسن"
PROFILE = load_profile(ROOT / "profiles" / "documents" / "army-exemption.json")


def line(text, left, top, right, bottom, score=0.9):
    return {"text": text, "score": score, "box": [left, top, right, bottom]}


def third_sample(**override):
    lines = {
        "ministry": line("وزارة الدفاع", 1448, 313, 1701, 387),
        "areaLabel": line("منطقة تجنيد .....", 1557, 442, 1683, 466),
        "area": line("الدقهلية", 1469, 442, 1539, 473),
        "title": line("شهادة بالإعفاء النهائي", 910, 434, 1230, 494),
        "clause": line("طبقا للمادة السابعة البند أولا فقرة", 889, 480, 1248, 531),
        "clause2": line("-(ب) من القانون رقم 1980/127", 888, 518, 1253, 576),
        "nameLabel": line("الاسم واللقب", 1540, 670, 1674, 709),
        "name": line(NAME, 1100, 677, 1480, 705),
        "birthLabel": line("تاريخ الميلاد", 822, 673, 953, 705),
        "birth": line("1995/03/14", 528, 658, 709, 693),
        "milLabel": line("رقم البطاقة العسكرية", 1424, 728, 1647, 762),
        "nidLabel": line("الرقم القومي وجهة صدوره", 1044, 737, 1317, 775),
        "codeLabel": line("كود", 892, 737, 940, 764),
        "numLabel": line("رقم القرار", 702, 741, 816, 781),
        "dateLabel": line("تاريخ القرار", 485, 741, 618, 785),
        "milLabel2": line("(الثلاثى) جهة صدورها", 1424, 752, 1647, 791),
        "codeLabel2": line("القرار", 880, 756, 954, 796),
        # The military card's number: three groups the detector found as three boxes.
        "mil1": line("1995", 1565, 812, 1645, 840),
        "mil2": line("123", 1492, 815, 1550, 839),
        "mil3": line("456", 1410, 809, 1476, 842),
        "nid": line(NID, 990, 808, 1268, 839),
        "code": line("4", 905, 805, 925, 835),
        "num": line("6789", 689, 799, 790, 827),
        "date": line("2016/02/21", 466, 786, 649, 833),
        # Where each number was issued, printed under it.
        "milPlace": line("ق.المنصورة", 1537, 875, 1645, 914),
        "nidPlace": line("ق.المنصورة", 1172, 863, 1285, 916),
        "decisionLabel": line("القرار:", 1600, 919, 1678, 952),
        "decision1": line("اعفاء المذكور نهائيا من اداء الخدمة", 1222, 944, 1603, 994),
        "decision2": line("العسكرية والوطنية كونه الابن الوحيد", 1221, 992, 1601, 1029),
        "decision3": line("لابيه المتوفى", 1457, 1029, 1600, 1075),
        "stampWords": line("خاتم شعار الدولة", 494, 951, 679, 994),
        "issueLabel": line("تاريخ تحرير الشهادة", 1501, 1257, 1687, 1312),
        "issue": line("2016/03/01", 1315, 1292, 1449, 1318),
    }
    for key, value in override.items():
        if value is None:
            lines.pop(key)
        else:
            lines[key] = value
    return list(lines.values())


def read(lines=None, **kwargs):
    return read_exemption_page(lines if lines is not None else third_sample(), PROFILE, today=TODAY, **kwargs)


def values(result):
    return {name: data["value"] for name, data in result.fields.items()}


def check(result, name):
    return next(item for item in result.evidence["checks"] if item["id"] == name)


# --- The fields the user marked ---------------------------------------------------------------

def test_every_marked_field_is_read():
    got = values(read())
    assert got["exemptionType"] == "نهائي"
    assert got["fullNameAr"] == NAME
    assert got["birthDate"] == "1995-03-14"
    assert got["militaryNumber"] == "1995123456"
    assert got["militaryIssuer"] == "ق.المنصورة"
    assert got["nationalId"] == NID
    assert got["nationalIdIssuer"] == "ق.المنصورة"
    assert got["decisionCode"] == "4"
    assert got["decisionNumber"] == "6789"
    assert got["decisionDate"] == "2016-02-21"
    assert got["issueDate"] == "2016-03-01"
    assert got["recruitmentArea"] == "الدقهلية"


def test_the_military_number_groups_are_joined_right_to_left():
    # Arabic runs right to left: the rightmost group is the first one.
    assert values(read())["militaryNumber"] == "1995123456"


def test_the_decision_reads_as_one_sentence_and_its_reason_is_summarised():
    result = read()
    assert "المتوفى" in result.fields["decision"]["value"]
    assert "خاتم" not in result.fields["decision"]["value"]  # the stamp's caption is not the decision
    assert result.fields["decisionReason"]["reasonId"] == "only_son_deceased_father"
    assert result.fields["decisionReason"]["value"]


def test_the_legal_clause_is_read_from_the_title():
    assert values(read())["legalClause"] == "أولاً (ب)"


def test_reasons_are_classified_by_their_words():
    assert classify_reason("اعفاء المذكور نهائيا من اداء الخدمة لعدم لياقته طبيا", PROFILE)[0] == "medical_unfit"
    assert classify_reason("العسكرية والوطنية كونه العائل للعائلة بعد ابيه المتجاوز سن ال60", PROFILE)[0] == "breadwinner"
    assert classify_reason("كونه الابن الوحيد لابيه الحي", PROFILE)[0] == "only_son_living_father"
    assert classify_reason("كونه الابن الوحيد لابيه المتجاوز سن الستين", PROFILE)[0] == "only_son_father_over_60"
    assert classify_reason("كلمات لا تعني شيئا هنا", PROFILE)[0] == "other"


# --- A worn certificate: what the detector lost, read again from the table's cells -------------

def test_a_number_the_detector_lost_is_read_again_from_its_cell():
    lines = third_sample(code=None, nid=line("234567", 1143, 808, 1268, 839), mil1=None)

    def reread(box, kind):
        left, right = box[0], box[2]
        if kind == "nationalId" and left < 1100 < right:
            return NID
        if kind == "digits" and left < 915 < right and right < 1000:
            return "4"
        if kind in ("digits", "groups") and left < 1600 < right:
            return "1995123456"
        return None

    got = values(read(lines, reread=reread))
    assert got["nationalId"] == NID
    assert got["decisionCode"] == "4"
    assert got["militaryNumber"] == "1995123456"


def test_a_name_read_short_is_read_again_from_its_place_on_the_row():
    lines = third_sample(name=line("محمد احمد", 1248, 677, 1363, 705))

    def reread(box, kind):
        return NAME if kind == "text" and box[0] < 1248 and box[2] > 1363 else None

    assert values(read(lines, reread=reread))["fullNameAr"] == NAME


def test_a_date_whose_slash_was_read_as_a_letter_is_still_a_date():
    lines = third_sample(birth=line("1995103ب14", 528, 658, 709, 693))
    assert values(read(lines))["birthDate"] == "1995-03-14"


# --- Consistency checks: parts of the certificate that must agree --------------------------------

def test_a_consistent_certificate_passes_every_check_and_matches():
    result = read()
    assert result.verdict.status == "match", result.verdict.reasons
    for name in ("type_matches_clause", "type_matches_decision", "reason_matches_type",
                 "birth_matches_national_id", "military_year_matches_birth", "area_matches_national_id"):
        assert check(result, name)["result"] == "pass", name


def test_a_final_title_over_a_temporary_clause_is_reported():
    result = read(third_sample(clause=line("طبقا للمادة السابعة البند ثانيا فقرة", 889, 480, 1248, 531)))
    assert check(result, "type_matches_clause")["result"] == "fail"
    assert "type_disagrees_with_clause" in result.verdict.reasons
    assert result.verdict.status != "match"


def test_a_final_title_over_a_temporary_decision_is_reported():
    result = read(third_sample(decision1=line("اعفاء المذكور مؤقتا من اداء الخدمة", 1222, 944, 1603, 994)))
    assert "type_disagrees_with_decision" in result.verdict.reasons


def test_a_reason_the_law_makes_temporary_under_a_final_title_is_reported():
    lines = third_sample(decision2=line("العسكرية والوطنية كونه العائل الوحيد", 1221, 992, 1601, 1029),
                         decision3=line("لابيه الغير قادر على الكسب", 1400, 1029, 1600, 1075))
    result = read(lines)
    assert result.fields["decisionReason"]["reasonId"] == "breadwinner"
    assert "reason_disagrees_with_type" in result.verdict.reasons


def test_a_military_number_from_another_birth_year_is_flagged_for_a_person():
    # Seen on every sample so far, not published as a rule: shown to the person, not a verdict.
    result = read(third_sample(mil1=line("1988", 1565, 812, 1645, 840)))
    assert check(result, "military_year_matches_birth")["result"] == "fail"
    assert check(result, "military_year_matches_birth")["strong"] is False
    assert result.verdict.status == "match"


def test_a_recruitment_area_in_another_governorate_is_flagged_for_a_person():
    # People move: the area is where he lives, the national ID where he was born registered.
    result = read(third_sample(area=line("القاهرة", 1469, 442, 1539, 473)))
    assert check(result, "area_matches_national_id")["result"] == "fail"
    assert result.verdict.status == "match"


def test_a_check_without_its_parts_is_unknown_not_passed():
    result = read(third_sample(area=None, areaLabel=None))
    assert check(result, "area_matches_national_id")["result"] == "unknown"


def test_no_check_claims_authenticity():
    import json

    text = json.dumps(read().evidence["checks"], ensure_ascii=False).lower()
    for word in ("genuine", "authentic", "real", "أصلي", "سليمة"):
        assert word not in text


# --- Measured on the real samples: OCR's habits on this form -------------------------------------

def test_a_slash_read_as_seven_is_still_a_slash():
    from nidocr.army_exemption import _parse_date

    # On the third sample "/" came back as the digit 7 (the Arabic ٧ is a slanted stroke).
    assert _parse_date("201671221").isoformat() == "2016-12-21"   # 2016/12/21: one "/" as 7, one lost
    assert _parse_date("2016712121").isoformat() == "2016-12-21"  # one as 7, one as 1


def test_a_closer_read_returns_the_groups_in_arabic_order():
    from nidocr.army_exemption import rtl_groups

    # A strip read left to right gives the groups as they sit on the page, last group first.
    assert rtl_groups("456 123 1995") == "1995123456"
    assert rtl_groups("1995123456") == "1995123456"  # no gaps read: nothing to reorder


def test_a_military_number_with_a_lost_group_is_read_again_in_groups():
    seen = []

    def reread(box, kind):
        seen.append(kind)
        return "1995123456" if kind == "groups" else None

    got = values(read(third_sample(mil1=None), reread=reread))
    assert "groups" in seen
    assert got["militaryNumber"] == "1995123456"


def test_a_name_whose_label_was_misread_is_read_again_without_the_label():
    lines = third_sample(nameLabel=line("الاسـسم واللقلب", 1540, 670, 1674, 709),
                         name=line("محمد احمد", 1248, 677, 1363, 705))
    boxes = []

    def reread(box, kind):
        if kind == "text":
            boxes.append(box)
            return NAME if box[2] < 1540 else "الاسم واللقب " + NAME
        return None

    assert values(read(lines, reread=reread))["fullNameAr"] == NAME
    assert boxes and boxes[0][2] < 1540


def test_where_a_number_was_issued_is_cleaned_to_the_printed_form():
    from nidocr.army_exemption import clean_place

    assert clean_place("م، سمالوط") == "م.سمالوط"
    assert clean_place("ق سمالوت") == "ق.سمالوط"     # one letter off a known district
    assert clean_place("ق.سمالوط") == "ق.سمالوط"


def test_the_recruitment_area_is_found_when_its_label_is_half_read():
    lines = third_sample(areaLabel=line("منطقة تجـ12ـد", 1557, 442, 1683, 466))
    assert values(read(lines))["recruitmentArea"] == "الدقهلية"


def test_a_sentence_mentioning_a_date_is_not_taken_for_a_label():
    lines = third_sample(issueLabel=None, issue=None,
                         decision3=line("لابيه المتوفى وعليه تقديم نفسه خلال 30 يوما من تاريخ زوال السبب", 1100, 1029, 1600, 1075))
    result = read(lines)
    assert "issueDate" not in result.fields
    assert "زوال" in result.fields["decision"]["value"]


def test_a_birth_date_that_disagrees_with_the_national_id_is_read_again():
    lines = third_sample(birth=line("1995/03/17", 528, 658, 709, 693))

    def reread(box, kind):
        return "1995/03/14" if kind == "date" and box[0] < 600 < box[2] else None

    result = read(lines, reread=reread)
    assert result.fields["birthDate"]["value"] == "1995-03-14"
    assert result.verdict.status == "match", result.verdict.reasons


def test_a_birth_date_read_again_differently_still_disagrees_and_is_reported():
    lines = third_sample(birth=line("1995/03/17", 528, 658, 709, 693))
    result = read(lines, reread=lambda box, kind: "1995/03/18" if kind == "date" else None)
    assert "birth_date_disagrees_with_national_id" in result.verdict.reasons


def test_a_slash_read_as_any_digit_after_a_year_gives_a_date_shown_low():
    from nidocr.army_exemption import _date_is_guessed, _parse_date

    # Measured on the third sample: 2016/02/21 came back with the year's last digit doubled.
    assert _parse_date("201660221").isoformat() == "2016-02-21"
    assert _date_is_guessed("201660221") is True
    assert _date_is_guessed("2016/02/21") is False
    assert _date_is_guessed("201610221") is False   # "/" as 1: measured often, not a guess
    lines = third_sample(date=line("201660221", 466, 786, 649, 833))
    result = read(lines)
    assert result.fields["decisionDate"]["value"] == "2016-02-21"
    assert result.fields["decisionDate"]["confidence"] == "low"


def test_a_slash_read_as_nine_after_a_year_ending_in_nine():
    from nidocr.army_exemption import _parse_date

    assert _parse_date("200991215").isoformat() == "2009-12-15"  # every digit is tried, 9 too


# --- Measured on the stress set (each sample turned, tilted, shrunk) -----------------------------

def test_the_type_comes_from_the_title_not_from_a_label_one_letter_off_it():
    # "(الثلاثى)" under the military card's label is one letter from "النهائي" once letters are folded
    # to their shapes; read high on a turned photo, it made a temporary exemption final.
    lines = third_sample(title=line("شهادة بالإعفاء المؤقت", 910, 434, 1230, 494),
                         clause=line("طبقا للمادة السابعة البند ثانيا فقرة", 889, 480, 1248, 531),
                         milLabel2=line("(الثلاثى) جهة صدورها", 1424, 300, 1647, 330),
                         decision1=line("اعفاء المذكور مؤقتا من اداء الخدمة", 1222, 944, 1603, 994),
                         decision2=line("العسكرية والوطنية كونه العائل لاسرته", 1221, 992, 1601, 1029))
    assert values(read(lines))["exemptionType"] == "مؤقت"


def test_a_name_with_a_word_one_letter_off_a_known_name_is_shown_low():
    result = read(third_sample(name=line("محمد احمم علي حسن", 1100, 677, 1480, 705)))
    assert result.fields["fullNameAr"]["confidence"] == "low"


def test_a_name_of_too_few_or_too_many_words_is_shown_low():
    for text in ("محمد احمد", "محمد احمد علي حسن محمود علي احمد"):
        result = read(third_sample(name=line(text, 1100, 677, 1480, 705)))
        assert result.fields["fullNameAr"]["confidence"] == "low", text


# --- Letters: names from the names list, the decision from the form's own words ------------------

def test_a_name_with_dot_and_tooth_misreads_is_corrected_from_the_names_list():
    # Seen by the user: محمد read مخمد (ح/خ differ by a dot), عبدالعظيم read عيدالعظيم (ب/ي, a tooth).
    result = read(third_sample(name=line("مخمد سعد عيدالعظيم حسن", 1100, 677, 1480, 705)))
    assert result.fields["fullNameAr"]["value"] == "محمد سعد عبدالعظيم حسن"


def test_the_decision_is_corrected_from_the_forms_own_words():
    from nidocr.army_exemption import correct_form_text

    # Seen by the user: العسكرية read الصكرية (ع and س merged into ص).
    assert correct_form_text("اعفاء المذكور نهائيا من اداء الخدمة الصكرية والوطنية", PROFILE) == \
        "اعفاء المذكور نهائيا من اداء الخدمة العسكرية والوطنية"
    assert correct_form_text("كونه الابن الوحيد لأبيه المتوفي", PROFILE).split()[-1] in ("المتوفي", "المتوفى")


def test_a_word_far_from_every_form_word_is_left_as_read():
    from nidocr.army_exemption import correct_form_text

    assert correct_form_text("واخيه يوسف القاصر", PROFILE) == "واخيه يوسف القاصر"


def test_a_name_missing_a_part_is_shown_low():
    # Measured on a turned photo of the worn sample: the family name was lost and three words came
    # back. The certificate prints the full four-part name, so three parts means one was lost.
    result = read(third_sample(name=line("محمد احمد علي", 1100, 677, 1480, 705)))
    assert result.fields["fullNameAr"]["confidence"] == "low"
