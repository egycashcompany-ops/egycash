"""Is this the document the reader was asked for? One answer shape for every document type.

- `match`: it looks like that document.
- `not_match`: it clearly is something else (another card, a face, a licence). The UI switches to
  its invalid state on this, and only on this.
- `unreadable`: nothing can be said either way, and the reasons tell the person what to change
  (a sharper photo, the other side, the number in view).

This says what the photo looks like, never that a document is genuine: a good copy of a real card
looks real, and only the issuer can say otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Status = Literal["match", "not_match", "unreadable"]

#: Capture-quality reasons (quality.py) → the verdict's reason codes.
_QUALITY_REASONS = {
    "blurred": "too_blurred",
    "too_small": "too_small",
    "glare": "glare",
    "low_contrast": "low_contrast",
}


@dataclass(frozen=True)
class Verdict:
    document_type: str
    status: Status
    reasons: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {"documentType": self.document_type, "status": self.status, "reasons": list(self.reasons)}


def _unique(reasons: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(reasons))


def _rejected_capture(result: Any) -> list[str]:
    """Reason codes from every side the quality gate refused; empty if none was refused."""
    reasons: list[str] = []
    for report in result.quality.values():
        if report.verdict == "reject":
            reasons += [_QUALITY_REASONS.get(reason, reason) for reason in report.reasons]
    return reasons


def _side_notes(result: Any) -> dict[str, dict[str, Any]]:
    return {side: notes for side, notes in result.diagnostics.items() if side in ("front", "back") and isinstance(notes, dict)}


def _no_text(result: Any) -> bool:
    sides = _side_notes(result)
    if not sides:
        return False
    for notes in sides.values():
        evidence = notes.get("cardEvidence") or {}
        lines = notes.get("linesDetected", evidence.get("lines"))
        if lines is None or lines > 0:
            return False
    return True


def national_id_verdict(result: Any) -> Verdict:
    """From `diagnostics.cardCheck` (see extract._side_verdict) and what was read."""
    name = "national_id"
    check = result.diagnostics.get("cardCheck") or {}
    card = check.get("verdict")
    number = result.fields.get("nationalId") or {}
    has_number = bool(number.get("value")) and bool(number.get("valid", True))

    if card == "not_national_id":
        if any((notes.get("cardEvidence") or {}).get("faceFillsFrame") for notes in _side_notes(result).values()):
            return Verdict(name, "not_match", ("looks_like_a_face",))
        reasons = ["no_card_structure"]
        if any((notes.get("cardEvidence") or {}).get("companyName") for notes in _side_notes(result).values()):
            reasons.append("looks_like_egycash_id")
        return Verdict(name, "not_match", _unique(reasons))

    if _no_text(result):
        return Verdict(name, "unreadable", ("no_text",))

    reasons: list[str] = []
    sides = _side_notes(result)
    if sides.get("front", {}).get("sideMismatch"):
        reasons.append("back_shown_for_front")
    if sides.get("back", {}).get("sideMismatch"):
        reasons.append("front_shown_for_back")
    reasons += _rejected_capture(result)

    if card == "national_id" and not reasons:
        return Verdict(name, "match", () if has_number else ("no_14_digit_number",))

    if not has_number:
        reasons.append("no_14_digit_number")
    if card != "national_id" and not reasons:
        reasons.append("no_card_structure")
    return Verdict(name, "unreadable", _unique(reasons))


def egycash_id_verdict(result: Any) -> Verdict:
    """From `diagnostics.badgeCheck` (see extract.extract_badge)."""
    name = "egycash_id"
    check = result.diagnostics.get("badgeCheck") or {}
    company = bool(check.get("companyFound"))
    code = bool(check.get("employeeCodeValid"))

    if check.get("faceFillsFrame"):
        return Verdict(name, "not_match", ("looks_like_a_face",))
    if _no_text(result):
        return Verdict(name, "unreadable", ("no_text",))
    # The national ID card's own title, and no company name: it is the other reader's document.
    if not company and check.get("nationalIdTitleWords", 0) >= 2:
        return Verdict(name, "not_match", ("looks_like_national_id", "company_name_missing"))

    missing = ([] if company else ["company_name_missing"]) + ([] if code else ["employee_code_invalid"])
    if check.get("verdict") == "egycash_badge":
        return Verdict(name, "match", ())
    rejected = _rejected_capture(result)
    if rejected:
        # A capture too poor to read is not evidence that it is another document.
        return Verdict(name, "unreadable", _unique(rejected + missing))
    if check.get("verdict") == "not_egycash_badge":
        return Verdict(name, "not_match", _unique(missing))
    return Verdict(name, "unreadable", _unique(missing or ["national_id_invalid"]))
