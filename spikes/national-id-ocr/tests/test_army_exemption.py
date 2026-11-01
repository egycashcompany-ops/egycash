"""The Army Exemption Certificate reader: format and consistency, never authenticity."""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.army_exemption import ExemptionProfile, load_profile, read_exemption_lines  # noqa: E402

VALID = "29503141234567"
#: A made-up profile, ONLY for exercising the logic. The real one is measured from samples.
PROFILE = ExemptionProfile(
    title_words=["شهادة", "اعفاء", "التجنيد"],
    min_title_words=2,
    fields={"fullNameAr": ["الاسم"], "nationalId": ["الرقم القومي"], "issueDate": ["تاريخ الاصدار"]},
    required=["fullNameAr", "nationalId"],
)
TODAY = date(2026, 10, 14)


def _certificate(**overrides) -> list[str]:
    rows = {
        "title": "شهادة اعفاء من التجنيد",
        "name": "الاسم: اسم تجريبي",
        "number": f"الرقم القومي: {VALID}",
        "issued": "تاريخ الاصدار: 2015/06/01",
    }
    rows.update(overrides)
    return [row for row in rows.values() if row]


def test_without_a_measured_profile_the_reader_says_so():
    read = read_exemption_lines(["سطر", "سطر اخر"], profile=ExemptionProfile(), today=TODAY)
    assert read.verdict.status == "unreadable"
    assert read.verdict.reasons == ("reader_not_configured",)
    assert read.fields == {}


def test_a_national_id_front_is_not_a_match_even_unconfigured():
    rows = ["جمهورية مصر العربية", "بطاقة تحقيق الشخصية", "اسم", VALID]
    read = read_exemption_lines(rows, profile=ExemptionProfile(), today=TODAY)
    assert read.verdict.status == "not_match"
    assert "looks_like_national_id" in read.verdict.reasons


def test_a_national_id_back_is_not_a_match_even_unconfigured():
    """The back prints no title, but its sex / religion / marital words are the card's alone."""
    rows = ["مهندس", "ذكر   مسلم", "متزوج", "البطاقة سارية حتى 2030/01/01", VALID]
    read = read_exemption_lines(rows, profile=ExemptionProfile(), today=TODAY)
    assert read.verdict.status == "not_match"
    assert "looks_like_national_id" in read.verdict.reasons


def test_an_egycash_id_is_not_a_match():
    read = read_exemption_lines(["EGY CASH", "الاسم محمد", "0100004"], profile=ExemptionProfile(), today=TODAY)
    assert read.verdict.status == "not_match"
    assert "looks_like_egycash_id" in read.verdict.reasons


def test_a_certificate_in_the_profiles_format_matches():
    read = read_exemption_lines(_certificate(), profile=PROFILE, today=TODAY)
    assert read.verdict.status == "match"
    assert read.fields["nationalId"]["value"] == VALID
    assert read.fields["nationalId"]["valid"] is True


def test_fields_are_never_high_confidence():
    read = read_exemption_lines(_certificate(), profile=PROFILE, today=TODAY)
    assert all(data["confidence"] != "high" for data in read.fields.values())


def test_an_impossible_number_is_unreadable_with_its_reason():
    read = read_exemption_lines(_certificate(number="الرقم القومي: 12345"), profile=PROFILE, today=TODAY)
    assert read.verdict.status == "unreadable"
    assert "national_id_invalid" in read.verdict.reasons


def test_a_future_issue_date_is_implausible():
    read = read_exemption_lines(_certificate(issued="تاريخ الاصدار: 2031/01/01"), profile=PROFILE, today=TODAY)
    assert "date_implausible" in read.verdict.reasons


def test_the_national_id_card_must_agree_when_both_were_scanned():
    holder = {"nationalId": "29001011234567", "fullNameAr": "اسم تجريبي"}
    read = read_exemption_lines(_certificate(), profile=PROFILE, holder=holder, today=TODAY)
    assert read.verdict.status == "unreadable"
    assert "national_id_disagrees_with_card" in read.verdict.reasons


def test_a_long_document_without_the_title_is_not_a_match():
    rows = [f"سطر رقم {i} من مستند اخر" for i in range(10)]
    read = read_exemption_lines(rows, profile=PROFILE, today=TODAY)
    assert read.verdict.status == "not_match"
    assert read.verdict.reasons == ("no_certificate_structure",)


def test_a_missing_required_field_is_named():
    read = read_exemption_lines(_certificate(name=""), profile=PROFILE, today=TODAY)
    assert "fullNameAr_missing" in read.verdict.reasons


def test_the_profile_is_loaded_from_json(tmp_path):
    path = tmp_path / "profile.json"
    path.write_text(json.dumps({"titleWords": ["شهادة"], "fields": {"nationalId": ["الرقم القومي"]}}), encoding="utf-8")
    profile = load_profile(path)
    assert profile.configured
    assert profile.fields == {"nationalId": ["الرقم القومي"]}


def test_no_profile_file_is_not_configured(tmp_path):
    assert not load_profile(tmp_path / "missing.json").configured


def test_the_wording_never_claims_authenticity():
    source = (ROOT / "src" / "nidocr" / "army_exemption.py").read_text(encoding="utf-8").lower()
    ui = (ROOT / "tools" / "ui" / "readers.js").read_text(encoding="utf-8").lower()
    assert "verified authentic" not in ui
    assert "is genuine" not in ui.replace("not proof a document is genuine", "")
    assert "can never say" in source  # the module states the limit it works within


def test_a_face_photo_is_not_a_match():
    read = read_exemption_lines([], profile=ExemptionProfile(), today=TODAY, face_fills_frame=True)
    assert read.verdict.status == "not_match"
    assert read.verdict.reasons == ("looks_like_a_face",)
