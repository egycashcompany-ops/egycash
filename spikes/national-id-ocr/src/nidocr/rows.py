"""Fields found by reading the whole card first, then deciding which printed row is which.

WHY THIS EXISTS. The box path decides WHERE each field is before reading anything: a profile puts
a rectangle on the card, anchoring nudges it toward detected text, and only the pixels inside are
read. On the first real card photographed for this spike that went wrong on every prose field —
the name box held only the second name line, the address came back as two letters, and the back's
occupation box covered the ID row — while `/read`, which simply reads every line on the photo,
returned all of them correctly. The information was always in the photo; the boxes threw it away.

So this path reads first and assigns second. Every line on the side is read at the photo's own
resolution (the same call `/read` makes), lines are grouped into printed rows, and the rows are
assigned by what an Egyptian card always prints, in order:

  front   header (republic, card title) · name (two rows) · address (the rest) · 14-digit ID row
  back    ID row (+ issue date) · occupation · gender/religion/marital row · "valid until" row

Assignment uses content, not coordinates: the ID row is the one made of digits, the back's status
row is the one carrying words from the closed gender/religion/marital vocabularies, the validity
row is the one that says سارية. Position is only used for what content cannot settle — which text
rows sit between two of those landmarks.

Fields it cannot place are left out, and `extract` falls back to the box path for exactly those.
A recognizer with no `read_page` (the model-free MockRecognizer) skips this path entirely, so every
box-path test still exercises the box path.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from .arabic import levenshtein, rasm_fold, to_western_digits
from .document import _bounds, _rows
from .postprocess import MARITAL_TERMS, RELIGION_TERMS, clean_expiry

_ARABIC_LETTER = re.compile(r"[ء-ي]")
_DIGIT = re.compile(r"\d")

#: Words from the printed header. A row carrying one, near the top, is furniture, and so is every
#: row above it (the calligraphic republic name is often read as garbage, so it cannot be matched
#: on its own — but it is always above the card title, which can).
_HEADER_WORDS = frozenset(rasm_fold(w) for w in ("بطاقة", "تحقيق", "الشخصية", "جمهورية", "العربية"))
_GENDER_WORDS = frozenset(rasm_fold(w) for w in ("ذكر", "أنثى", "انثي"))
_RELIGION = {rasm_fold(term): term for term in RELIGION_TERMS}
_MARITAL = {rasm_fold(term): term for term in MARITAL_TERMS}
#: Words that open or fill an Egyptian address and never a person's name.
_ADDRESS_WORDS = frozenset(
    rasm_fold(w)
    for w in ("ش", "شارع", "برج", "عمارة", "عماره", "قسم", "مركز", "حي", "الحي", "الحى", "ميدان",
              "شياخة", "قرية", "عزبة", "مدينة", "مدينه", "طريق", "بلوك")
)
_VALIDITY_WORDS = frozenset(rasm_fold(w) for w in ("سارية", "حتى", "حتي"))

#: The fields this path can produce, per side.
SIDE_FIELDS = {
    "front": ("fullNameAr", "address", "nationalId"),
    "back": ("occupation", "religion", "maritalStatus", "nationalIdExpiry", "nationalId"),
}


@dataclass
class RowRead:
    """What reading by rows produced for one side."""

    #: field name -> (raw text, score, [left, top, right, bottom] of the lines it came from)
    fields: dict[str, tuple[str, float, tuple[float, float, float, float]]] = field(
        default_factory=dict
    )
    #: Every line read, as (polygon, text, score) — the shape `detect_lines` returns, so the
    #: back-of-card checks (printed gender, side mismatch) work on these unchanged.
    lines: list[tuple[object, str, float]] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    #: The image each field's bounds refer to. A field may come from the zoomed or the enhanced
    #: read (see `read_by_rows`), and a crop taken from the wrong image is a crop of nothing.
    images: dict[str, np.ndarray] = field(default_factory=dict)
    #: Which reads were made, for the diagnostics: 'photo', 'zoomed xN', 'enhanced'.
    passes: list[str] = field(default_factory=list)
    #: On the back: the gap between the sex word and the marital status, where the religion is
    #: printed — kept so a religion detection missed can be read from exactly there.
    religion_gap: tuple[float, float, float, float] | None = None
    #: On the back: the year of the issue date printed beside the ID (its month is often misread,
    #: so only the year is kept). For the cross-checks in `crosscheck.py`; never returned.
    issue_year: int | None = None


def _letters(text: str) -> int:
    return len(_ARABIC_LETTER.findall(text))


def _digits(text: str) -> str:
    return "".join(_DIGIT.findall(to_western_digits(text)))


def _is_number_part(line: dict[str, Any]) -> bool:
    """A piece of the ID row: digits only, no date slash, no words."""
    text = line["text"]
    # No Latin letters either: the front's serial ('AB1234567') is digits plus Latin, and counting
    # only Arabic letters let its digits join the national ID whenever it shared the ID's row.
    return (
        "/" not in text
        and _letters(text) == 0
        and not re.search(r"[A-Za-z]", text)
        and len(_digits(text)) >= 2
    )


def _tokens(row: list[dict[str, Any]]) -> list[str]:
    return [rasm_fold(token.strip("-–—:.,،")) for line in row for token in line["text"].split()]


def _union(lines: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    return (
        min(line["box"][0] for line in lines),
        min(line["box"][1] for line in lines),
        max(line["box"][2] for line in lines),
        max(line["box"][3] for line in lines),
    )


def _rtl_text(row: list[dict[str, Any]]) -> str:
    return " ".join(line["text"] for line in sorted(row, key=lambda item: -item["box"][2]))


def _text_field(rows: list[list[dict[str, Any]]]) -> tuple[str, float, tuple] | None:
    lines = [line for row in rows for line in row]
    if not lines:
        return None
    text = " ".join(_rtl_text(row) for row in rows).strip()
    score = float(np.mean([line["score"] for line in lines]))
    return text, score, _union(lines)


def _id_row(rows: list[list[dict[str, Any]]]) -> int | None:
    """The row whose number-only lines hold the most digits, if that is at least ten."""
    best, best_count = None, 9
    for index, row in enumerate(rows):
        count = sum(len(_digits(line["text"])) for line in row if _is_number_part(line))
        if count > best_count:
            best, best_count = index, count
    return best


#: A date's year at the start of a short run: the back prints the issue date (YYYY/MM) on the ID's
#: row, and with its slash misread as ١ it is a digits-only line like any piece of the number.
_DATE_LIKE = re.compile(r"^(19|20)\d{2}")


def _id_field(row: list[dict[str, Any]]) -> tuple[str, float, tuple]:
    # Digits read left to right even on a right-to-left card: the groups are joined by x.
    parts = sorted((line for line in row if _is_number_part(line)), key=lambda item: item["box"][0])
    whole = [line for line in parts if 13 <= len(_digits(line["text"])) <= 15]
    if whole:
        # Read in one piece: that piece IS the number, whatever else shares the row.
        parts = [min(whole, key=lambda line: abs(len(_digits(line["text"])) - 14))]
    else:
        undated = [
            line
            for line in parts
            if not (_DATE_LIKE.match(_digits(line["text"])) and len(_digits(line["text"])) <= 8)
        ]
        # Only drop what looked like a date if what is left can still be the number: a piece of
        # the ID itself can start with 19 or 20 (a month and day, '2012'), and dropping it lost
        # real digits.
        if len("".join(_digits(line["text"]) for line in undated)) >= 12:
            parts = undated
    raw = "".join(_digits(line["text"]) for line in parts)
    return raw, min(line["score"] for line in parts), _union(parts)


def _is_prose(line: dict[str, Any]) -> bool:
    return _letters(line["text"]) >= 2


def _prose_row(row: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A row's text, or nothing if the row has no Arabic words.

    Numbers are kept when they share a row with words: an address starts with its house number,
    and on a far-away photo the detector reads '٣٥٥' as a line of its own — dropping number-only
    lines threw the house number away. A row of numbers alone is not prose, and stray Latin
    fragments (noise read off the background pattern) never are.
    """
    if not any(_is_prose(line) for line in row):
        return []
    return [line for line in row if _is_prose(line) or (_digits(line["text"]) and not re.search(r"[A-Za-z]", line["text"]))]


#: Share of the front, from the top of its text to the ID row, that the printed header occupies.
HEADER_SHARE = 0.22


def _centre(row: list[dict[str, Any]]) -> float:
    return float(np.mean([(line["box"][1] + line["box"][3]) / 2.0 for line in row]))


def _front(rows: list[list[dict[str, Any]]], out: RowRead) -> None:
    id_index = _id_row(rows)
    if id_index is not None:
        out.fields["nationalId"] = _id_field(rows[id_index])

    # Everything above the ID row; the header and anything above it removed.
    body = rows[:id_index] if id_index is not None else rows
    header = None
    for index, row in enumerate(body[: max(1, len(body) // 2 + 1)]):
        if any(token in _HEADER_WORDS for token in _tokens(row)):
            header = index
    if header is not None:
        body = body[header + 1 :]
    elif id_index is not None and body:
        # The card title did not read (on a tiny card its letters are a few pixels tall), so the
        # garbled header would be taken for the first name. Find it by position instead: from the
        # top of the text to the ID row, the header fills the first ~quarter (on a real card it
        # ends at 0.16 and the first name starts at 0.32).
        top = min(line["box"][1] for line in body[0])
        bottom = _centre(rows[id_index])
        span = max(bottom - top, 1.0)
        body = [row for row in body if (_centre(row) - top) / span >= HEADER_SHARE]
    text_rows = [_prose_row(row) for row in body]
    text_rows = [row for row in text_rows if row]
    if not text_rows:
        return

    # A real card prints the name on two rows (given name, then the rest) and the address below.
    # A name that fits may sit on one row, though, and then the second row is the address's first
    # — which is recognisable: a name carries no digits and none of the address's own words. With
    # only two rows there is no way to know the name wrapped, so it gets one.
    second_is_address = len(text_rows) > 1 and any(
        _DIGIT.search(to_western_digits(line["text"])) or any(
            rasm_fold(token) in _ADDRESS_WORDS for token in line["text"].split()
        )
        for line in text_rows[1]
    )
    split = 2 if len(text_rows) >= 3 and not second_is_address else 1
    # A name has no digits, so a number on a name row is background noise read as text; only the
    # address keeps its numbers (see `_prose_row`).
    name_rows = [[line for line in row if _is_prose(line)] for row in text_rows[:split]]
    for name, chosen in (("fullNameAr", name_rows), ("address", text_rows[split:])):
        read = _text_field(chosen)
        if read is not None:
            out.fields[name] = read


def _issue_year(row: list[dict[str, Any]]) -> int | None:
    """The issue date's year, from the date-like piece on the back's ID row."""
    for line in row:
        digits = _digits(line["text"])
        if _DATE_LIKE.match(digits) and 4 <= len(digits) <= 8:
            return int(digits[:4])
    return None


def _back(rows: list[list[dict[str, Any]]], out: RowRead) -> None:
    id_index = _id_row(rows)
    if id_index is not None:
        out.fields["nationalId"] = _id_field(rows[id_index])
        out.issue_year = _issue_year(rows[id_index])

    status_index = None
    for index, row in enumerate(rows):
        tokens = _tokens(row)
        religion = _vocabulary(tokens, _RELIGION)
        marital = _vocabulary(tokens, _MARITAL)
        if religion or marital or any(t in _GENDER_WORDS for t in tokens):
            status_index = index
            out.religion_gap = _religion_gap(row)
            scores = [line["score"] for line in row]
            box = _union(row)
            if religion is None:
                religion = _religion_by_position(row)
                if religion is not None:
                    # A deduction from position, not a read: kept below the review threshold.
                    out.fields["religion"] = (religion, min(0.6, float(np.mean(scores))), box)
            elif religion:
                out.fields["religion"] = (religion, float(np.mean(scores)), box)
            if marital:
                out.fields["maritalStatus"] = (marital, float(np.mean(scores)), box)
            # The sex word travels with both terms, so the cleanup can make them agree with it: a
            # dropped trailing ة turns متزوجة into متزوج, still a real word, and only the أنثى on
            # the same printed row says which was printed (`postprocess._agree_in_gender`).
            sex = next(
                (t for line in row for t in line["text"].split() if rasm_fold(t) in _GENDER_WORDS),
                None,
            )
            if sex is not None:
                for name in ("religion", "maritalStatus"):
                    if name in out.fields:
                        raw, score, where = out.fields[name]
                        out.fields[name] = (f"{sex} {raw}", score, where)
            break

    for index, row in enumerate(rows):
        if any(token in _VALIDITY_WORDS for token in _tokens(row)):
            dated = max(row, key=lambda line: len(_digits(line["text"])))
            if len(_digits(dated["text"])) >= 6:
                out.fields["nationalIdExpiry"] = (dated["text"], dated["score"], _union([dated]))
            break

    # The occupation is whatever prose sits between the ID row and the status row.
    start = id_index + 1 if id_index is not None else 0
    end = status_index if status_index is not None else min(start + 1, len(rows))
    between = [_prose_row(row) for row in rows[start:end]]
    read = _text_field([row for row in between if row])
    if read is not None:
        out.fields["occupation"] = read


def _religion_gap(row: list[dict[str, Any]]) -> tuple[float, float, float, float] | None:
    """Between the sex word (right) and the marital status (left): where the religion is printed."""
    gender = marital = None
    for line in row:
        folded = {rasm_fold(token) for token in line["text"].split()}
        if folded & _GENDER_WORDS:
            gender = line["box"]
        if folded & set(_MARITAL):
            marital = line["box"]
    if gender is None or marital is None or marital[2] >= gender[0]:
        return None
    top = min(gender[1], marital[1])
    bottom = max(gender[3], marital[3])
    return (marital[2], top, gender[0], bottom)


def _read_religion_gap(image: np.ndarray, read: RowRead, recognizer: object) -> None:
    """Read the religion from its gap when page detection never found it (a watermark under it)."""
    gap = read.religion_gap
    recognize = getattr(recognizer, "recognize", None)
    if gap is None or recognize is None or "religion" in read.fields:
        return
    left, top, right, bottom = (int(v) for v in gap)
    pad = (bottom - top) // 3
    crop = image[max(0, top - pad) : bottom + pad, max(0, left) : right]
    if crop.size == 0:
        return
    crop = cv2.resize(crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    try:
        out = recognize(crop, rtl=True)
    except Exception:  # noqa: BLE001
        return
    tokens = [rasm_fold(token) for token in out.text.split()]
    exact = _vocabulary(tokens, _RELIGION)
    if exact is not None:
        read.fields["religion"] = (exact, float(out.score), gap)
        read.images["religion"] = image


def _religion_by_position(row: list[dict[str, Any]]) -> str | None:
    """The religion word when blur has left too little of it to match: read from where it sits.

    The status row prints sex, religion and marital status right to left, always in that order.
    With the sex word found (it is short and survives blur best), the next word to its left is the
    religion, and there are only four it can be. The nearest of them is taken, in the grammatical
    gender the sex word gives — a blurred 'مسلم' read as 'مسد' is still nearer مسلم than مسيحي.
    """
    words = [
        (line["box"][2], token)
        for line in row
        for token in line["text"].split()
        if _letters(token) >= 2
    ]
    words.sort(key=lambda item: -item[0])
    folded = [rasm_fold(token) for _, token in words]
    gender = next((i for i, token in enumerate(folded) if token in _GENDER_WORDS), None)
    marital = next((i for i, token in enumerate(folded) if token in _MARITAL), None)
    # Religion sits right after the sex word, and right before the marital status. Either anchor
    # will do: on a small photo the short sex word is sometimes the one that did not read.
    if gender is not None and gender + 1 < len(words):
        index = gender + 1
        feminine = folded[gender] != rasm_fold("ذكر")
    elif marital is not None and marital >= 1:
        index = marital - 1
        feminine = _MARITAL[folded[marital]].endswith(("ة", "اء"))
    else:
        return None
    candidate = folded[index]
    if candidate in _MARITAL or candidate in _GENDER_WORDS or _letters(words[index][1]) < 2:
        return None
    terms = [t for t in RELIGION_TERMS if t.endswith("ة") == feminine]
    distances = sorted((levenshtein(candidate, rasm_fold(t), limit=6), t) for t in terms)
    if len(distances) > 1 and distances[0][0] == distances[1][0]:
        return None
    return distances[0][1]


def _vocabulary(tokens: list[str], vocabulary: dict[str, str]) -> str | None:
    """The vocabulary word among these tokens: exact first, then one edit away.

    One edit, and only for tokens of three letters or more: a blurred مسلم comes back as ملم, and
    at that distance it is still closer to مسلم than to any other word on the back of a card. A
    two-letter fragment is not evidence of anything.
    """
    exact = next((vocabulary[t] for t in tokens if t in vocabulary), None)
    if exact is not None:
        return exact
    for token in tokens:
        if len(token) < 3:
            continue
        near = [word for key, word in vocabulary.items() if levenshtein(token, key, limit=1) <= 1]
        if len(near) == 1:
            return near[0]
    return None


# ── zoom and enhancement ───────────────────────────────────────────────────────
#
# The recognizer reads printed lines best at a few dozen pixels tall. A card photographed from
# far away puts its text at 10-15 px inside a 4000 px frame; a blurred or dark photo leaves the
# strokes too soft to separate. Both are recoverable from the same photo: crop to where the text
# is and enlarge it, and raise the local contrast. Each costs one more full read, so they run only
# when the read of the photo as given came back WEAK — a clean close-up pays nothing.

#: Median line height the zoom aims for, in pixels: about what a close-up phone photo of a card
#: gives, which is where the recognizer was measured reading every field correctly.
TARGET_LINE_HEIGHT = 110
MAX_ZOOM = 4.0
#: The zoomed image's longest side is capped, so a tiny card in a huge frame cannot become a page
#: the detector takes a minute over.
MAX_SIDE = 3200
#: Mean field score below which a read counts as weak even with every field placed.
WEAK_SCORE = 0.90


def _lines(image: np.ndarray, read) -> list[dict[str, Any]]:
    try:
        found = read(image)
    except Exception:  # noqa: BLE001 — a failed extra pass costs the pass, not the card
        return []
    return [
        {"text": text.strip(), "score": float(score), "box": _bounds(poly)}
        for poly, text, score in found
        if text and text.strip()
    ]


#: A tilt below this is left alone: rows group fine and rotating costs a full re-read.
MIN_SKEW = 1.0
#: A tilt above this is not a slightly crooked card, and the orientation step owns it.
MAX_SKEW = 15.0


def _polys(image: np.ndarray, read) -> list[tuple[object, str, float]]:
    try:
        return [(poly, text, score) for poly, text, score in read(image) if text and text.strip()]
    except Exception:  # noqa: BLE001 — a failed read costs the card's rows, never the request
        return []


def _as_line_dicts(found: list[tuple[object, str, float]]) -> list[dict[str, Any]]:
    return [
        {"text": text.strip(), "score": float(score), "box": _bounds(poly)}
        for poly, text, score in found
    ]


def _skew(found: list[tuple[object, str, float]]) -> float | None:
    """The card's tilt in degrees, from the slope of its long lines. None if level enough.

    WHY THIS MATTERS. Rows are grouped by vertical position, and the ID row is the longest line on
    the card. Tilted a few degrees, its left end sits a whole line-height away from its right end,
    so it is split into two "rows" — and only the half with more digits is taken as the number. A
    far-away card tilted 6 degrees lost its first two digits exactly that way, in every variant.
    """
    angles = []
    for poly, _, _ in found:
        try:
            points = np.asarray(poly, dtype=float).reshape(-1, 2)
        except (TypeError, ValueError):
            continue
        if len(points) != 4:
            continue
        dx, dy = points[1] - points[0]
        width = float(np.hypot(dx, dy))
        height = float(np.linalg.norm(points[3] - points[0]))
        if width > 3 * max(height, 1.0):
            angles.append(float(np.degrees(np.arctan2(dy, dx))))
    if len(angles) < 2:
        return None
    angle = float(np.median(angles))
    return angle if MIN_SKEW <= abs(angle) <= MAX_SKEW else None


def _level(image: np.ndarray, angle: float) -> np.ndarray:
    """Rotate by `angle` degrees so the text runs level, growing the canvas so nothing is cut."""
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_width, new_height = int(height * sin + width * cos), int(height * cos + width * sin)
    matrix[0, 2] += new_width / 2 - width / 2
    matrix[1, 2] += new_height / 2 - height / 2
    return cv2.warpAffine(
        image, matrix, (new_width, new_height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def _zoom(image: np.ndarray, lines: list[dict[str, Any]]) -> tuple[np.ndarray, float] | None:
    """Crop to the text and scale it to `TARGET_LINE_HEIGHT`. None when that changes nothing."""
    text = [
        line
        for line in lines
        if line["score"] >= 0.5 and (_letters(line["text"]) or _digits(line["text"]))
    ]
    if len(text) < 2:
        return None
    heights = sorted(line["box"][3] - line["box"][1] for line in text)
    line_height = max(heights[len(heights) // 2], 1.0)
    left, top, right, bottom = _union(text)
    # Generous, because the rows the first read MISSED are exactly the ones this pass is for, and
    # they lie outside the union of the ones it found — on a far-away back the whole ID row did.
    pad_x = max(line_height * 2, (right - left) * 0.15)
    pad_y = max(line_height * 2, (bottom - top) * 0.35)
    height, width = image.shape[:2]
    left, top = max(0, int(left - pad_x)), max(0, int(top - pad_y))
    right, bottom = min(width, int(right + pad_x)), min(height, int(bottom + pad_y))
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        return None
    scale = min(MAX_ZOOM, TARGET_LINE_HEIGHT / line_height, MAX_SIDE / max(crop.shape[:2]))
    # Never shrink: the photo pass already read the text at its own size, and shrinking a blurred
    # photo only blurs it further.
    if scale < 1.25:
        return None
    interpolation = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
    return cv2.resize(crop, size, interpolation=interpolation), scale


def _enhance(image: np.ndarray) -> np.ndarray:
    """Local contrast up (CLAHE on lightness), then a mild unsharp mask. Colour is kept."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, a, b = cv2.split(lab)
    lightness = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(lightness)
    contrasted = cv2.cvtColor(cv2.merge((lightness, a, b)), cv2.COLOR_LAB2BGR)
    soft = cv2.GaussianBlur(contrasted, (0, 0), 1.5)
    return cv2.addWeighted(contrasted, 1.6, soft, -0.6, 0)


def _assign(image: np.ndarray, side: str, lines: list[dict[str, Any]], label: str) -> RowRead:
    out = RowRead()
    out.lines = [
        (
            np.array([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], dtype=float),
            line["text"],
            line["score"],
        )
        for line in lines
        for b in (line["box"],)
    ]
    rows = _rows(lines)
    out.rows = [[line["text"] for line in row] for row in rows]
    (_front if side == "front" else _back)(rows, out)
    out.images = {name: image for name in out.fields}
    out.passes = [label]
    return out


def _sound(name: str, raw: str) -> bool:
    """Does this field's raw text have the shape the card prints? Prose has no shape to check."""
    if name == "nationalId":
        return len(_digits(raw)) == 14
    if name == "nationalIdExpiry":
        return clean_expiry(raw)[1]
    return True


def _weak(read: RowRead, side: str) -> bool:
    fields = read.fields
    if any(name not in fields for name in SIDE_FIELDS[side]):
        return True
    if not all(_sound(name, raw) for name, (raw, _, _) in fields.items()):
        return True
    return float(np.mean([score for _, score, _ in fields.values()])) < WEAK_SCORE


def _merge(reads: list[RowRead]) -> RowRead:
    """Each field from the read that got it best: a sound value first, then the higher score.

    Per field rather than per read, because the passes fail differently: a zoomed read can recover
    the religion and lose a digit the plain read had, and keeping either read whole would throw
    away the other's correct field.
    """
    merged = RowRead(
        lines=reads[0].lines,
        rows=reads[0].rows,
        passes=[label for read in reads for label in read.passes],
        issue_year=next((read.issue_year for read in reads if read.issue_year), None),
    )
    # The name and the address are cut from the SAME run of rows — where one ends the other
    # begins — so they must come from the same read. Taken separately, one read's one-row name
    # and another read's address that starts below ITS two-row name lost the name's second line
    # between them on a real card. The pair comes from whichever read placed more text in them.
    paired = ("fullNameAr", "address")
    with_both = [read for read in reads if all(name in read.fields for name in paired)]
    if with_both:
        best = max(
            with_both,
            key=lambda read: (
                sum(len(read.fields[name][0].replace(" ", "")) for name in paired),
                sum(read.fields[name][1] for name in paired),
            ),
        )
        for name in paired:
            merged.fields[name] = best.fields[name]
            merged.images[name] = best.images[name]
    for name in {name for read in reads for name in read.fields} - set(merged.fields):
        best = max(
            (read for read in reads if name in read.fields),
            key=lambda read: (_sound(name, read.fields[name][0]), read.fields[name][1]),
        )
        merged.fields[name] = best.fields[name]
        merged.images[name] = best.images[name]
    return merged


def _as_dicts(read: RowRead) -> list[dict[str, Any]]:
    return [
        {"text": text, "score": score, "box": _bounds(poly)} for poly, text, score in read.lines
    ]


def read_by_rows(image: np.ndarray, side: str, recognizer: object) -> RowRead | None:
    """Read every line on this side and assign the fields. None if the recognizer cannot.

    The photo as given is read first. Only if that read is weak — a field missing, a number that
    is not fourteen digits, an expiry that is not a date, or a low mean score — is it read again
    zoomed onto the text, and then, if still weak, zoomed and enhanced. Fields are merged across
    the reads that were made.
    """
    read = getattr(recognizer, "read_page", None)
    if read is None:
        return None
    found = _polys(image, read)
    angle = _skew(found)
    if angle is not None:
        image = _level(image, angle)
        reads = [_assign(image, side, _lines(image, read), f"levelled {angle:+.1f}°")]
    else:
        reads = [_assign(image, side, _as_line_dicts(found), "photo")]
    if side == "back":
        _read_religion_gap(image, reads[0], recognizer)
    if not _weak(reads[0], side):
        return reads[0]

    base = image
    zoomed = _zoom(image, _as_dicts(reads[0]))
    if zoomed is not None:
        base, scale = zoomed
        reads.append(_assign(base, side, _lines(base, read), f"zoomed x{scale:.1f}"))
        if side == "back":
            _read_religion_gap(base, reads[-1], recognizer)
        if not _weak(reads[-1], side):
            return _merge(reads)

    enhanced = _enhance(base)
    reads.append(_assign(enhanced, side, _lines(enhanced, read), "enhanced"))
    if side == "back":
        _read_religion_gap(enhanced, reads[-1], recognizer)
    return _merge(reads)
