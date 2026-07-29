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


# ── Rasm folding ─────────────────────────────────────────────────────────────
# Arabic letters are built from a small set of skeletons (the *rasm*) plus dots. ب ت ث ن ي share one
# skeleton and differ only in how many dots sit above or below it; so do ج ح خ, and د ذ, and ر ز,
# and س ش, and ص ض, and ط ظ, and ع غ, and ف ق.
#
# Dots are exactly what an OCR model loses first. They are the smallest marks on the card, they are
# the first thing a JPEG artefact swallows, and on a laminated card they are the first thing a
# reflection erases. A recogniser that reads مسلمة as مسلمه has read the *shape* perfectly and
# guessed one dot wrong — but string comparison scores that as a miss, and the reviewer retypes a
# field the model effectively got right.
#
# Folding to the skeleton makes the comparison ignore precisely the information that was destroyed,
# and nothing else. That is why it is safe here and would not be safe as a general normalization:
# it deliberately conflates real, distinct words, so it is only ever used to match against a small
# CLOSED vocabulary where the members are known not to collide. `postprocess` checks that.
_RASM = {
    "ب": "ٮ", "ت": "ٮ", "ث": "ٮ", "ن": "ٮ", "ي": "ٮ", "ى": "ٮ", "ئ": "ٮ", "پ": "ٮ",
    "ج": "ح", "خ": "ح", "چ": "ح",
    "ذ": "د",
    "ز": "ر", "ژ": "ر",
    "ش": "س",
    "ض": "ص",
    "ظ": "ط",
    "غ": "ع",
    "ف": "ڡ", "ق": "ڡ", "ڤ": "ڡ",
    "ة": "ه",
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ؤ": "و",
    "گ": "ك", "ک": "ك",
}


def rasm_fold(value: str) -> str:
    """Strip Arabic dotting to the bare letter skeleton. Comparison only — never for storage."""
    text = normalize_arabic(value)
    return "".join(_RASM.get(character, character) for character in text)


def levenshtein(left: str, right: str, *, limit: int = 2) -> int:
    """Edit distance, abandoned once it provably exceeds `limit`.

    The limit is not just an optimisation. Every caller here is asking "is this near-miss the same
    word?", and beyond a couple of edits the answer is no regardless of the exact number — so
    computing it precisely would be spending work to produce a value that is then thrown away.
    """
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    if left == right:
        return 0

    previous = list(range(len(right) + 1))
    for i, left_character in enumerate(left, start=1):
        current = [i]
        for j, right_character in enumerate(right, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (left_character != right_character),
                )
            )
        if min(current) > limit:
            return limit + 1
        previous = current
    return previous[-1]
