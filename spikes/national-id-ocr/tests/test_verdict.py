"""One verdict shape for every reader: match | not_match | unreadable, with reason codes."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import ExtractionResult, _side_verdict  # noqa: E402
from nidocr.quality import QualityReport  # noqa: E402
from nidocr.verdict import egycash_id_verdict, national_id_verdict  # noqa: E402

VALID = {"value": "29901011234567", "confidence": "high", "valid": True}


def _nid(card=None, sides=None, quality=None, fields=None, **notes) -> ExtractionResult:
    result = ExtractionResult()
    if card is not None:
        result.diagnostics["cardCheck"] = {"verdict": card, "sides": sides or {}}
    for side, data in notes.items():
        result.diagnostics[side] = data
    for side, verdict in (quality or {}).items():
        reasons = ("blurred",) if verdict == "reject" else ()
        result.quality[side] = QualityReport(verdict, reasons, {})
    result.fields.update(fields or {})
    return result


# ── National ID Card ─────────────────────────────────────────────────────────────────────────────


def test_a_recognised_card_with_its_number_is_a_match():
    verdict = national_id_verdict(_nid("national_id", {"front": "yes"}, fields={"nationalId": VALID}))
    assert verdict.status == "match"
    assert verdict.document_type == "national_id"


def test_another_card_is_not_a_match_for_lack_of_card_structure():
    verdict = national_id_verdict(_nid("not_national_id", {"front": "no"}))
    assert verdict.status == "not_match"
    assert "no_card_structure" in verdict.reasons


def test_a_blurred_capture_is_unreadable_and_says_so():
    result = _nid("unsure", {"front": "unsure"}, quality={"front": "reject"})
    verdict = national_id_verdict(result)
    assert verdict.status == "unreadable"
    assert "too_blurred" in verdict.reasons


def test_no_number_and_no_title_is_unreadable_naming_both():
    verdict = national_id_verdict(_nid("unsure", {"front": "unsure"}, front={"cardEvidence": {"lines": 3}}))
    assert verdict.status == "unreadable"
    assert "no_14_digit_number" in verdict.reasons


def test_the_back_shown_where_the_front_was_expected_is_named():
    result = _nid("unsure", {"front": "unsure"}, front={"sideMismatch": True})
    verdict = national_id_verdict(result)
    assert verdict.status == "unreadable"
    assert "back_shown_for_front" in verdict.reasons


def test_a_photo_with_no_text_at_all_is_unreadable_no_text():
    verdict = national_id_verdict(_nid(None, front={"linesDetected": 0}))
    assert verdict.status == "unreadable"
    assert "no_text" in verdict.reasons


def test_an_egycash_id_shown_to_the_national_id_reader_is_not_a_match():
    """The company's name on the front is decisive: a national ID never prints it."""
    evidence = {"lines": 9, "titleWords": 0, "validNumber": True, "portrait": True, "companyName": True}
    assert _side_verdict("front", evidence) == "no"


def test_a_national_id_front_with_its_title_still_matches():
    evidence = {"lines": 12, "titleWords": 2, "validNumber": True, "portrait": True, "companyName": False}
    assert _side_verdict("front", evidence) == "yes"


def test_the_verdict_serialises_for_the_api():
    data = national_id_verdict(_nid("not_national_id", {"front": "no"})).as_dict()
    assert data == {"documentType": "national_id", "status": "not_match", "reasons": ["no_card_structure"]}


# ── EGY CASH ID ──────────────────────────────────────────────────────────────────────────────────


def _badge(verdict, company=False, code=False, national=False, lines=6, nid_title=0, quality="ok"):
    result = ExtractionResult()
    result.diagnostics["badgeCheck"] = {
        "verdict": verdict, "companyFound": company, "employeeCodeValid": code,
        "nationalIdValid": national, "labelled": [], "nationalIdTitleWords": nid_title,
    }
    result.diagnostics["front"] = {"linesDetected": lines}
    result.quality["front"] = QualityReport(quality, ("blurred",) if quality == "reject" else (), {})
    return result


def test_a_company_badge_with_a_code_is_a_match():
    verdict = egycash_id_verdict(_badge("egycash_badge", company=True, code=True))
    assert verdict.status == "match"
    assert verdict.document_type == "egycash_id"


def test_no_company_and_no_code_is_not_a_match_naming_both():
    verdict = egycash_id_verdict(_badge("not_egycash_badge"))
    assert verdict.status == "not_match"
    assert {"company_name_missing", "employee_code_invalid"} <= set(verdict.reasons)


def test_a_national_id_card_shown_to_the_egycash_reader_is_not_a_match():
    """Its own valid number does not make it a badge; the national ID's title says what it is."""
    verdict = egycash_id_verdict(_badge("unsure", national=True, nid_title=2))
    assert verdict.status == "not_match"
    assert "looks_like_national_id" in verdict.reasons


def test_company_found_but_nothing_else_is_unreadable():
    verdict = egycash_id_verdict(_badge("unsure", company=True))
    assert verdict.status == "unreadable"
    assert "employee_code_invalid" in verdict.reasons


def test_a_blank_photo_is_unreadable_no_text():
    verdict = egycash_id_verdict(_badge("not_egycash_badge", lines=0))
    assert verdict.status == "unreadable"
    assert verdict.reasons == ("no_text",)


def test_a_rejected_capture_is_unreadable_not_a_wrong_document():
    verdict = egycash_id_verdict(_badge("not_egycash_badge", lines=2, quality="reject"))
    assert verdict.status == "unreadable"
    assert "too_blurred" in verdict.reasons


# ── A face, not a document ───────────────────────────────────────────────────────────────────────


def test_a_face_filling_the_photo_is_not_a_national_id_side():
    evidence = {"lines": 0, "titleWords": 0, "validNumber": False, "portrait": True, "faceFillsFrame": True}
    assert _side_verdict("front", evidence) == "no"


def test_a_face_photo_is_not_a_match_and_says_why():
    result = _nid("not_national_id", {"front": "no"},
                  front={"cardEvidence": {"lines": 0, "faceFillsFrame": True}, "linesDetected": 0})
    verdict = national_id_verdict(result)
    assert verdict.status == "not_match"
    assert "looks_like_a_face" in verdict.reasons


def test_a_face_photo_is_not_an_egycash_id():
    result = _badge("not_egycash_badge", lines=0)
    result.diagnostics["badgeCheck"]["faceFillsFrame"] = True
    verdict = egycash_id_verdict(result)
    assert verdict.status == "not_match"
    assert "looks_like_a_face" in verdict.reasons
