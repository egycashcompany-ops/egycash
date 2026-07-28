"""Structural validation of an Egyptian national ID — for CONFIDENCE BANDING ONLY.

This is a deliberate, narrow mirror of `parseNationalId` in
`packages/contracts/src/common/value-objects.ts`. It exists for one reason: a 14-digit string that
cannot possibly be a national ID (impossible month, unknown governorate, birth date in the future)
is almost certainly a misread, and the pipeline should hand it back as LOW confidence rather than
as a clean value a human might wave through.

It does NOT derive anything. Birth date, gender and governorate are computed exactly once, in
TypeScript, by the real `parseNationalId` — the frozen rule from the OCR seam's header comment:
"the number-derived fields are NOT part of this — they are computed downstream". Duplicating the
derivation here would create a second source of truth for a value the contract already owns.

Structure: C YYMMDD GG SSSS K
  C  = century (2 → 19xx, 3 → 20xx)
  GG = governorate code
  K  = check digit (not publicly documented — structural checks only, same as the TS side)
"""

from __future__ import annotations

import datetime as _dt
import re

# Same table as EGYPT_GOVERNORATE_CODES in the contracts package. Kept as a set of codes rather
# than a code→name map: naming the governorate is the TypeScript side's job, not ours.
GOVERNORATE_CODES = frozenset(
    {
        "01", "02", "03", "04", "11", "12", "13", "14", "15", "16", "17", "18", "19",
        "21", "22", "23", "24", "25", "26", "27", "28", "29",
        "31", "32", "33", "34", "35", "88",
    }
)

_FOURTEEN_DIGITS = re.compile(r"^\d{14}$")


def is_structurally_valid(value: str, *, today: _dt.date | None = None) -> bool:
    """True when `value` could be a real Egyptian national ID. No derivation, no side effects."""
    if not _FOURTEEN_DIGITS.match(value):
        return False

    century = value[0]
    if century not in ("2", "3"):
        return False
    base = 1900 if century == "2" else 2000

    year = base + int(value[1:3])
    month = int(value[3:5])
    day = int(value[5:7])
    try:
        birth = _dt.date(year, month, day)
    except ValueError:
        return False  # impossible calendar date (month 13, 31 February, …)
    if birth > (today or _dt.date.today()):
        return False  # a card cannot belong to someone not yet born

    return value[7:9] in GOVERNORATE_CODES


def salvage_digits(raw: str) -> str:
    """Strip everything that is not a digit, after folding Indic numerals.

    OCR routinely inserts spaces inside the number (the card itself prints it in groups) and
    occasionally a stray separator. Removing non-digits BEFORE validating is what turns a
    cosmetically noisy read into a usable one; it cannot turn a wrong digit into a right one.
    """
    from .arabic import to_western_digits

    return re.sub(r"\D", "", to_western_digits(raw))
