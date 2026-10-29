"""Checks that hold between fields, applied after every field has been read.

Each field already carries its own evidence: the recognizer's score, a structural check, the
vote across both sides. What none of them can see is a field that is internally fine and
inconsistent with the rest of the card — an expiry that is a good date seven years too late, an
ID whose birth date makes the holder eleven when the card was issued. Those are misreads too, and
the card itself proves them wrong.

The checks only ever LOWER confidence. A failed check says "one of these values is misread, and a
person should look"; it never says which, so nothing is corrected here. The codes of the failed
checks go to the diagnostics; they describe the card's consistency, never its content.

The validity period is configurable because its legal source was not found — Wikipedia and an
Arabic encyclopedia both say seven years; `CARD_VALIDITY_YEARS` overrides it.
"""

from __future__ import annotations

import datetime as _dt
import os
from typing import Any

from .postprocess import cap

CARD_VALIDITY_YEARS = int(os.environ.get("CARD_VALIDITY_YEARS", "7"))
#: The issue YEAR is read reliably; its month often is not (its slash is misread as a digit), so
#: validity is checked on years, with one year either side for the month boundary.
VALIDITY_TOLERANCE_YEARS = 1
#: Egyptians are issued a card at 16. Younger at issue means a digit of the birth date is wrong.
MIN_AGE_AT_ISSUE = 16


def birth_date(national_id: str) -> _dt.date | None:
    """The birth date the number encodes, or None if it encodes none."""
    if len(national_id) != 14 or not national_id.isdigit() or national_id[0] not in "23":
        return None
    try:
        return _dt.date(
            (1900 if national_id[0] == "2" else 2000) + int(national_id[1:3]),
            int(national_id[3:5]),
            int(national_id[5:7]),
        )
    except ValueError:
        return None


def _expiry(fields: dict[str, dict[str, Any]]) -> _dt.date | None:
    try:
        return _dt.date.fromisoformat(fields.get("nationalIdExpiry", {}).get("value") or "")
    except ValueError:
        return None


def cross_check(
    fields: dict[str, dict[str, Any]],
    issue_year: int | None,
    *,
    today: _dt.date | None = None,
) -> list[str]:
    """Lower the confidence of fields that contradict each other. → codes of the checks failed."""
    today = today or _dt.date.today()
    failed: list[str] = []
    expiry = _expiry(fields)
    birth = birth_date(fields.get("nationalId", {}).get("value") or "")

    def lower(name: str, to: str, code: str) -> None:
        if name in fields:
            fields[name]["confidence"] = cap(fields[name]["confidence"], to)
        failed.append(code)

    if expiry is not None and not (1990 <= expiry.year <= today.year + CARD_VALIDITY_YEARS + 1):
        lower("nationalIdExpiry", "low", "expiryImplausible")

    if issue_year is not None and not (1990 <= issue_year <= today.year):
        issue_year = None  # the issue year itself is misread; check nothing against it

    if issue_year is not None and expiry is not None:
        if expiry.year < issue_year:
            lower("nationalIdExpiry", "low", "expiryBeforeIssue")
        elif abs((expiry.year - issue_year) - CARD_VALIDITY_YEARS) > VALIDITY_TOLERANCE_YEARS:
            # Either date could be the misread one; the expiry is the one that is returned.
            lower("nationalIdExpiry", "medium", "validityPeriod")

    if birth is not None:
        if issue_year is not None and issue_year - birth.year < MIN_AGE_AT_ISSUE - 1:
            lower("nationalId", "low", "tooYoungAtIssue")
        elif issue_year is None and today.year - birth.year < MIN_AGE_AT_ISSUE - 1:
            lower("nationalId", "medium", "tooYoung")

    return failed
