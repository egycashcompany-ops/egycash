"""Arabic text normalization — a deliberate mirror of `apps/api/src/modules/hr/shared/arabic.ts`.

Two jobs, and they are different:

* `normalize_arabic` folds orthographic variants so that comparing OCR output against ground
  truth measures RECOGNITION quality, not the model's choice of hamza carrier. It is the same
  fold the API already applies for search, so a name the OCR reads and a name a recruiter types
  compare identically. Kept byte-for-byte equivalent to the TypeScript version on purpose: if the
  two ever disagree, the spike's accuracy numbers stop predicting production behaviour.

* `to_western_digits` converts Eastern Arabic-Indic numerals (٠١٢٣…) to ASCII. Egyptian ID cards
  print every number — the national ID itself, the expiry date — in Indic form, while
  `parseNationalId` and every date parser downstream expect ASCII. This conversion is the single
  most load-bearing line in the whole pipeline: get it wrong and the national ID never validates.
"""

from __future__ import annotations

import re
import unicodedata

# Arabic diacritics (tashkeel) + tatweel — stripped entirely, exactly as the TS version does.
_DIACRITICS = re.compile(
    "[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]"
)

# Eastern Arabic-Indic (U+0660..) and the Extended/Persian set (U+06F0..). Cards use the former,
# but scanners and phone keyboards emit the latter often enough to be worth folding too.
_INDIC_DIGITS = {ord("٠") + i: str(i) for i in range(10)}
_INDIC_DIGITS.update({ord("۰") + i: str(i) for i in range(10)})

_FOLD = {
    "أ": "ا",  # أ → ا
    "إ": "ا",  # إ → ا
    "آ": "ا",  # آ → ا
    "ٱ": "ا",  # ٱ → ا
    "ى": "ي",  # ى → ي
    "ة": "ه",  # ة → ه
    "ؤ": "و",  # ؤ → و
    "ئ": "ي",  # ئ → ي
}


def to_western_digits(value: str) -> str:
    """Arabic-Indic → ASCII digits. Everything else is left untouched."""
    return value.translate(_INDIC_DIGITS)


def normalize_arabic(value: str) -> str:
    """Fold to the search-stable form the API uses. See module docstring for why."""
    text = unicodedata.normalize("NFKC", value)
    text = _DIACRITICS.sub("", text)
    for src, dst in _FOLD.items():
        text = text.replace(src, dst)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def collapse_spaces(value: str) -> str:
    """Whitespace-only cleanup, preserving orthography — for values shown back to a human."""
    return re.sub(r"\s+", " ", value).strip()
