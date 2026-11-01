"""The EGY CASH ID (the employee badge, renamed): company, name, job position, employee code, national ID number.

Unlike the national ID, whose fields are at known places, a company badge is whatever its designer
drew, and its layout can change between print runs. So this reads every line of the badge and
decides what each one is from what it says: the company's name, the words that label a field
("الاسم", "الوظيفة", "كود الموظف", "الرقم القومي") and the shape of the digits (fourteen of them is a
national ID, seven to ten is an employee code). Position decides only between the two that look
alike, the name and the job title, and only when no label says which is which.

The checks this adds, which a plain read does not make:

- the national ID number must be structurally possible (century digit, a real birth date, a
  governorate), like the national ID card's own;
- the employee code is `<branch code><employee number>` (ADR-017 of the main project, e.g.
  `010` + `0004` = `0100004`): digits only, at least seven;
- the company's name must be there, so a photo of some other badge is not read as this one.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .arabic import levenshtein, normalize_arabic, rasm_fold, to_western_digits
from .document import _rows
from .nid import is_structurally_valid, repair

_ARABIC_LETTER = re.compile(r"[ء-ي]")
_LATIN = re.compile(r"[A-Za-z]")

#: The company's name as printed. On the badge it is the company's logo, in English, like the one
#: on its website: "EGY" in bold and "CASH" in light, with the tagline under it. The Arabic
#: spellings are kept in case a badge prints it that way. Set `EGYCASH_COMPANY_NAMES` (comma
#: separated) to change them without touching the code.
COMPANY_NAMES = tuple(
    name.strip()
    for name in os.environ.get("EGYCASH_COMPANY_NAMES", "EGY CASH,EGYCASH,ايجي كاش,إيجي كاش,ايجى كاش").split(",")
    if name.strip()
)
#: How the company's name is written in the result, whichever way it was found.
COMPANY_VALUE = "EGY CASH"
#: The tagline under the logo, as evidence of the logo when the name itself was not read.
TAGLINE = "TECHNOLOGICAL CASH SOLUTIONS"
#: The logo's picture, for finding it on the badge when its letters could not be read.
LOGO_PATH = Path(os.environ.get("EGYCASH_LOGO", Path(__file__).resolve().parents[2] / "profiles" / "egycash-logo.png"))
#: Match strength (0-1) at which the logo is taken to be on the badge.
LOGO_MATCH = float(os.environ.get("EGYCASH_LOGO_MATCH", "0.55"))

#: Employee code: the hiring branch's code (three digits) and the employee number (four or more).
CODE_MIN_DIGITS = 7
CODE_MAX_DIGITS = 10

#: Words that label a field, longest first. A label is folded the way the text is: no hamza, no
#: dots, ى as ي, so "الرقم القومى" and "الرقم القومي" are one label.
LABELS: dict[str, tuple[str, ...]] = {
    "nationalId": ("الرقم القومي", "رقم قومي", "الرقم القومى", "رقم البطاقة", "الرقم الوطني"),
    "employeeCode": ("كود الموظف", "رقم الموظف", "الكود الوظيفي", "رقم وظيفي", "كود", "الكود"),
    "jobTitle": ("المسمى الوظيفي", "المسمي الوظيفي", "الوظيفة", "الوظيفه", "وظيفة", "المسمى", "الوظيفى"),
    "fullNameAr": ("اسم الموظف", "الاسم", "اسم"),
}

#: Words a job title is made of. A soft signal: used to tell the title from the name, not to
#: reject anything.
JOB_WORDS = """
مدير مديرة موظف موظفة محاسب محاسبة امين امينة كاشير مندوب مندوبة مشرف مشرفة مسؤول مسئول مهندس مهندسة
فني فنية سائق حارس امن عامل عاملة مساعد مساعدة رئيس رئيسة نائب نائبة اخصائي اخصائية تنفيذي تنفيذية
اداري ادارية محلل محللة مطور مصمم سكرتير سكرتيرة مراجع مراجعة تسويق مبيعات عملاء خزينة خزينه فرع
الفرع حسابات موارد بشرية قانوني قانونية مبرمج مبرمجة دعم تحصيل ائتمان متابعة مخازن مشتريات
""".split()


def _fold(text: str) -> str:
    return rasm_fold(normalize_arabic(text))


def _letters(text: str) -> int:
    return len(_ARABIC_LETTER.findall(text))


def _digits(text: str) -> str:
    return "".join(c for c in to_western_digits(text) if c.isdigit())


@dataclass
class BadgeRead:
    """What the lines of a badge came to, with where each field was read."""

    #: field → (raw text, score, (left, top, right, bottom))
    fields: dict[str, tuple[str, float, tuple[float, float, float, float]]] = field(default_factory=dict)
    #: Whether the company's name was on the badge.
    company_found: bool = False
    #: Which fields a label named (as opposed to being told apart by what they say).
    labelled: set[str] = field(default_factory=set)


def _label_prefix(tokens: list[tuple[str, float, tuple]], at: int) -> tuple[str | None, int]:
    """→ (the field the words from `at` start by naming, how many words the label takes).

    The detector boxes a label word by word ("كود", then "الموظف"), so a label is looked for across
    the row's words, longest label first, with a trailing colon ignored.
    """
    folded = [_fold(token[0].rstrip(":：")) for token in tokens]
    best: tuple[int, str] | None = None
    for name, phrases in LABELS.items():
        for phrase in phrases:
            wanted = [_fold(word) for word in phrase.split()]
            if folded[at : at + len(wanted)] == wanted and (best is None or len(wanted) > best[0]):
                best = (len(wanted), name)
    return (best[1], best[0]) if best else (None, 0)


def _latin_key(text: str) -> str:
    """Capital letters only: 'Egy  Cash' and 'EGY-CASH' are the same."""
    return re.sub(r"[^A-Z]", "", text.upper())


def _is_logo_text(text: str) -> bool:
    """Is this line the logo's wording: the name, or the tagline under it?"""
    key = _latin_key(text)
    if len(key) < 5:
        return False
    for name in ("EGYCASH",):
        # The name alone, or as part of a longer line (the name beside the tagline), with a letter
        # or two wrong: the logo's two weights make "EGY" and "CASH" easy to misread.
        if levenshtein(key, name, limit=2) <= 2:
            return True
        for start in range(0, max(1, len(key) - len(name) + 1)):
            if levenshtein(key[start : start + len(name)], name, limit=2) <= 1:
                return True
    tag = _latin_key(TAGLINE)
    return len(key) >= 12 and levenshtein(key, tag, limit=6) <= 5


def _is_company(text: str) -> bool:
    """Is this line the company's name (allowing a letter or two the recognizer got wrong)?"""
    if _letters(text) == 0 and _is_logo_text(text):
        return True
    folded = [_fold(token) for token in text.split() if _letters(token)]
    for name in COMPANY_NAMES:
        if _letters(name) == 0:
            continue
        wanted = [_fold(token) for token in name.split()]
        if len(wanted) == 1:
            if any(levenshtein(token, wanted[0], limit=2) <= 1 for token in folded):
                return True
            continue
        for start in range(len(folded) - len(wanted) + 1):
            window = folded[start : start + len(wanted)]
            if all(levenshtein(a, b, limit=2) <= (1 if len(b) > 3 else 0) for a, b in zip(window, wanted)):
                return True
    return False


def _name_score(text: str) -> float:
    """How much this prose looks like a person's name: known given names, and three or four words."""
    from .lexicon import _index  # noqa: PLC0415

    known = _index("name")[0]
    words = normalize_arabic(text).split()
    if not words:
        return 0.0
    share = sum(1 for word in words if word in known or word.startswith("عبد")) / len(words)
    shape = 1.0 if 2 <= len(words) <= 5 else 0.3
    return share + 0.4 * shape


def _job_score(text: str) -> float:
    words = {_fold(word) for word in text.split()}
    return sum(1 for word in JOB_WORDS if _fold(word) in words) / max(len(words), 1)


def read_badge_lines(lines: list[dict[str, Any]]) -> BadgeRead:
    """Assign the fields of a badge from its lines: dicts of text, score, box (an upright badge)."""
    out = BadgeRead()
    rows = _rows(lines)
    # Items found: (text, score, box). A label alone takes its value from the rest of its row or,
    # failing that, from the next row. A row is read whole: the detector cuts a name into a box per
    # word, and a field is the row's boxes together, not the first of them.
    claimed: dict[str, list[tuple[str, float, tuple[float, float, float, float]]]] = {}
    free: list[tuple[str, float, tuple[float, float, float, float]]] = []
    pending: str | None = None

    def joined(parts):
        """Boxes of one row, right to left, as one item."""
        text = " ".join(part[0] for part in parts)
        score = sum(part[1] for part in parts) / len(parts)
        box = (min(p[2][0] for p in parts), min(p[2][1] for p in parts), max(p[2][2] for p in parts), max(p[2][3] for p in parts))
        return text, score, box

    for row in rows:
        row = sorted(row, key=lambda line: line["box"][2], reverse=True)  # right to left
        tokens = [(token, line["score"], tuple(line["box"])) for line in row for token in line["text"].split()]
        if any(_letters(token[0]) for token in tokens):
            # Speckle read as Latin letters between Arabic words ("lw" in the middle of a name)
            # is not part of it; a row with no Arabic in it (a code) keeps what it has.
            tokens = [token for token in tokens if not (_LATIN.search(token[0]) and token[1] < 0.6)]
        if not tokens:
            continue
        # The row's words in segments: a label starts one, and the words up to the next label (or
        # the end of the row) are its value. A row without a label is one segment of its own.
        segments: list[tuple[str | None, list]] = []
        i = 0
        while i < len(tokens):
            name, used = _label_prefix(tokens, i)
            if name is not None:
                segments.append((name, []))
                i += used
                continue
            if not segments:
                segments.append((None, []))
            segments[-1][1].append(tokens[i])
            i += 1
        for name, parts in segments:
            if name is not None:
                out.labelled.add(name)
                if parts:
                    claimed.setdefault(name, []).append(joined(parts))
                    pending = None
                else:
                    pending = name
            elif pending is not None and parts:
                claimed.setdefault(pending, []).append(joined(parts))
                pending = None
            elif parts:
                free.append(joined(parts))

    # The company: any line (labelled or not) that says its name.
    for text, score, box in list(free):
        if _is_company(text):
            out.company_found = True
            value = COMPANY_VALUE if _letters(text) == 0 else text
            out.fields.setdefault("companyName", (value, score, box))
            free.remove((text, score, box))

    def numbers(items):
        return [(text, score, box) for text, score, box in items if _letters(text) == 0 and _digits(text)]

    # National ID number: labelled, else a line of fourteen digits (or close: a misread digit).
    national = claimed.get("nationalId") or []
    if not national:
        pool = [item for item in numbers(free) if 12 <= len(_digits(item[0])) <= 16]
        national = sorted(pool, key=lambda item: abs(len(_digits(item[0])) - 14))[:1]
    if national:
        out.fields["nationalId"] = national[0]
        free = [item for item in free if item is not national[0]]

    code = claimed.get("employeeCode") or []
    if not code:
        pool = [item for item in numbers(free) if CODE_MIN_DIGITS - 1 <= len(_digits(item[0])) <= CODE_MAX_DIGITS]
        code = sorted(pool, key=lambda item: -item[1])[:1]
    if code:
        out.fields["employeeCode"] = code[0]
        free = [item for item in free if item is not code[0]]

    # Name and job title: the label says which; when neither does, what each says does.
    prose = [item for item in free if _letters(item[0]) >= 2 and not _LATIN.search(item[0])]
    name = (claimed.get("fullNameAr") or [None])[0]
    job = (claimed.get("jobTitle") or [None])[0]
    if name is None and job is None and prose:
        by_name = max(prose, key=lambda item: (_name_score(item[0]) - _job_score(item[0]), item[1]))
        name = by_name
        rest = [item for item in prose if item is not by_name]
        if rest:
            job = max(rest, key=lambda item: (_job_score(item[0]), -abs(item[2][1] - by_name[2][3])))
    elif name is None and prose:
        name = max((item for item in prose if item is not job), key=lambda item: _name_score(item[0]), default=None)
    elif job is None and prose:
        job = max((item for item in prose if item is not name), key=lambda item: _job_score(item[0]), default=None)
    if name:
        out.fields["fullNameAr"] = name
    if job:
        out.fields["jobTitle"] = job
    return out


# ── The logo ─────────────────────────────────────────────────────────────────────────────────────

_LOGO: np.ndarray | None = None


def _logo_grey() -> np.ndarray | None:
    """The logo as a grey picture on white, loaded once. None if the file is missing."""
    global _LOGO  # noqa: PLW0603 - read-only after the first call
    if _LOGO is None:
        raw = cv2.imread(str(LOGO_PATH), cv2.IMREAD_UNCHANGED)
        if raw is None:
            return None
        if raw.ndim == 3 and raw.shape[2] == 4:
            alpha = raw[..., 3:4].astype(np.float32) / 255.0
            raw = (raw[..., :3].astype(np.float32) * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)
        _LOGO = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
    return _LOGO


def find_logo(image: np.ndarray) -> tuple[float, tuple[float, float, float, float]] | None:
    """Where the company's logo is on this picture, if it is: (match strength, its box in pixels).

    Looked for as a picture, at several sizes, dark on light and (for a logo printed white on a
    coloured band) light on dark: the reader that is used for text cannot be relied on to read
    stylised letters, and the logo is the company's name.
    """
    logo = _logo_grey()
    if logo is None:
        return None
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    scale = min(1.0, 900.0 / max(grey.shape[:2]))
    small = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1.0 else grey
    best: tuple[float, tuple[float, float, float, float]] | None = None
    for polarity in (False, True):
        source = cv2.bitwise_not(small) if polarity else small
        for share in (0.08, 0.1, 0.12, 0.14, 0.17, 0.2, 0.24, 0.28, 0.33, 0.38, 0.5):
            width = int(share * small.shape[1])
            height = int(width * logo.shape[0] / logo.shape[1])
            if height < 12 or height >= small.shape[0] or width >= small.shape[1]:
                continue
            template = cv2.resize(logo, (width, height), interpolation=cv2.INTER_AREA)
            if polarity:
                template = cv2.bitwise_not(template)
            scores = cv2.matchTemplate(source, template, cv2.TM_CCOEFF_NORMED)
            _, top, _, at = cv2.minMaxLoc(scores)
            if best is None or top > best[0]:
                best = (float(top), (at[0] / scale, at[1] / scale, (at[0] + width) / scale, (at[1] + height) / scale))
    return best if best is not None and best[0] >= LOGO_MATCH else None


# ── Validation ───────────────────────────────────────────────────────────────────────────────────


#: How far left of the code's row a re-read may reach without a national ID row to line up with,
#: and the margin kept before that row's start (both shares of the badge's width).
CODE_REACH_SHARE = 0.30
CODE_MARGIN_SHARE = 0.015


def widen_code_box(
    code: tuple[float, float, float, float],
    national: tuple[float, float, float, float] | None,
    width: int,
    neighbours: list[tuple[float, float, float, float]] | tuple = (),
) -> tuple[float, float, float, float]:
    """The strip to read a code again in, when the detector cut its row short.

    The label is at the right and the digits run left of it. On a real badge the detector boxed the
    label with two of seven digits and never boxed the other five. The strip keeps the code line's
    own height and reaches left: to where the national ID number's row starts (it is printed in the
    same column), else a share of the badge; and never past the next thing printed on the same row
    (the signature's caption sat there), whose words are not part of the code.
    """
    left, top, right, bottom = code
    margin = CODE_MARGIN_SHARE * width
    if national is not None:
        reach = max(0.0, national[0] - margin)
    else:
        reach = max(0.0, left - CODE_REACH_SHARE * width)
    middle = (top + bottom) / 2
    on_row = [box[2] for box in neighbours if box[2] <= left and box[1] <= middle <= box[3]]
    if on_row:
        reach = max(reach, max(on_row) + margin)
    return (min(left, reach), top, right, bottom)


def employee_code_valid(value: str) -> bool:
    """`<branch code><employee number>`: digits only, seven to ten of them."""
    return value.isdigit() and CODE_MIN_DIGITS <= len(value) <= CODE_MAX_DIGITS


def clean_employee_code(raw: str) -> tuple[str, bool]:
    """→ (the code's digits, whether they have the shape of a code). Indic numerals are folded."""
    digits = _digits(raw)
    return digits, employee_code_valid(digits)


def badge_verdict(company_found: bool, code_valid: bool, national_valid: bool) -> str:
    """'egycash_badge', 'not_egycash_badge' or 'unsure', from what was found on the card."""
    if company_found and (code_valid or national_valid):
        return "egycash_badge"
    # A badge always carries its employee code: without the company's name and without a code, what
    # was photographed is something else, a national ID card included (it has a valid national ID
    # number and neither of those).
    if not company_found and not code_valid:
        return "not_egycash_badge"
    return "unsure"


def national_id_of(raw: str):
    """The national ID number's repair outcome (see `nid.repair`)."""
    return repair(raw)


__all__ = [
    "BadgeRead", "COMPANY_NAMES", "widen_code_box", "COMPANY_VALUE", "badge_verdict", "find_logo", "clean_employee_code", "employee_code_valid",
    "is_structurally_valid", "national_id_of", "read_badge_lines",
]
