"""Fields found by reading the whole card first, then deciding which printed row is which."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from .arabic import levenshtein, normalize_arabic, rasm_fold, to_western_digits
from .document import _bounds, _rows
from .postprocess import MARITAL_TERMS, RELIGION_TERMS, clean_expiry

_ARABIC_LETTER = re.compile(r"[ء-ي]")
_DIGIT = re.compile(r"\d")

#: Words from the printed header.
_HEADER_WORDS = frozenset(rasm_fold(w) for w in ("بطاقة", "تحقيق", "الشخصية", "جمهورية", "العربية"))
_GENDER_WORDS = frozenset(rasm_fold(w) for w in ("ذكر", "أنثى", "انثي"))
_RELIGION = {rasm_fold(term): term for term in RELIGION_TERMS}
_MARITAL = {rasm_fold(term): term for term in MARITAL_TERMS}
#: Words that open or fill an Egyptian address and never a person's name.
_ADDRESS_WORDS = frozenset(
    rasm_fold(w)
    for w in ("ش", "شارع", "برج", "عمارة", "عماره", "قسم", "مركز", "حي", "الحي", "الحى", "ميدان",
              "شياخة", "قرية", "قريه", "عزبة", "عزبه", "مدينة", "مدينه", "طريق", "بلوك", "نجع",
              "كفر", "منشاة", "منشأة", "منشية", "حارة", "حاره", "عطفة", "عطفه", "درب", "ناحية")
)
#: Address words found even glued to the word before them, a soft photo loses the hyphen in
#: 'البراهمه-نجع جوده' and reads 'البراهمهنجع'.
_GLUED_ADDRESS_WORDS = tuple(
    normalize_arabic(w) for w in ("نجع", "عزبة", "شارع", "مركز", "قرية", "منشاة", "شياخة")
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
    #: Every line read, as (polygon, text, score), the shape `detect_lines` returns, so the
    #: back-of-card checks (printed gender, side mismatch) work on these unchanged.
    lines: list[tuple[object, str, float]] = field(default_factory=list)
    #: The lines of the other reads (zoomed, enhanced), for checks that need only their words, such
    #: as the printed sex. Kept apart so line counts and positions stay those of the first read.
    pass_lines: list[tuple[object, str, float]] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    #: The image each field's bounds refer to. A field may come from the zoomed or the enhanced
    #: read (see `read_by_rows`), and a crop taken from the wrong image is a crop of nothing.
    images: dict[str, np.ndarray] = field(default_factory=dict)
    #: Which reads were made, for the diagnostics: 'photo', 'zoomed xN', 'enhanced'.
    passes: list[str] = field(default_factory=list)
    #: field name -> (left limit, right limit) a wider re-read of the field must stay inside, in
    #: the same image's pixels; None for no limit.
    fences: dict[str, tuple[float | None, float | None]] = field(default_factory=dict)
    #: On the back: the gap between the sex word and the marital status, where the religion is
    #: printed, kept so a religion detection missed can be read from exactly there.
    religion_gap: tuple[float, float, float, float] | None = None
    #: On the back: the year of the issue date printed beside the ID (its month is often misread,
    #: so only the year is kept). For the cross-checks in `crosscheck.py`; never returned.
    issue_year: int | None = None
    #: On the front: the birth date printed beside the ID, as YYYYMMDD. The number carries the
    #: same date in its digits 2-7, so it is an independent read of half the number.
    birth: str | None = None
    #: On the front: where the name's two rows should be, and the rows found there (see
    #: `_recover_name`). None when the header or the ID row was not found to measure from.
    name_geo: dict[str, Any] | None = None
    #: True when `_recover_name` changed the name.
    recovered_name: bool = False


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
    """The row whose number-only lines hold the most digits, if that is at least six."""
    best, best_count = None, 5
    for index, row in enumerate(rows):
        row = [_undated(line) for line in row]
        count = sum(
            len(_digits(line["text"]))
            for line in row
            if _is_number_part(line)
            and not _is_date(_digits(line["text"]))
        )
        if count > best_count:
            best, best_count = index, count
    return best


#: A date's year at the start of a short run: the back prints the issue date (YYYY/MM) on the ID's
#: row, and with its slash misread as ١ it is a digits-only line like any piece of the number.
_DATE_LIKE = re.compile(r"^(19|20)\d{2}")

#: The same dates with each slash read as ١, the way the recognizer most often reads a slash:
#: '2003/07/25' as 2003107125, '2019/12' as 2019112. Ten and seven digits, so the "at most eight"
#: rule above let them join the number as pieces of it.
_SLASHED_DATE = re.compile(r"^(?:19|20)\d{2}1(?:0[1-9]|1[0-2])(?:1(?:0[1-9]|[12]\d|3[01]))?$")


#: A date written with separators, inside a longer piece of text.
_DATE_IN_LINE = re.compile(r"(?:19|20)\d{2}\s*[/\|.\-]\s*\d{1,2}(?:\s*[/\|.\-]\s*\d{1,2})?")


def _undated(line: dict[str, Any]) -> dict[str, Any]:
    """`line` with a date at either end of it taken off, its box shortened to match.

    The detector sometimes boxes the issue date (back) or birth date (front) together with the
    first digits of the number beside it; the slash then kept the whole box out of the number, and
    the number came back short by those digits.
    """
    text = to_western_digits(line["text"])
    match = _DATE_IN_LINE.search(text)
    if match is None:
        return line
    rest = (text[: match.start()] + " " + text[match.end():]).strip()
    if len(_digits(rest)) < 2 or "/" in rest or (match.start() > 0 and match.end() < len(text)):
        return line  # nothing left of the number, or the date sits in the middle of something
    left, top, right, bottom = line["box"]
    share = len(rest) / max(len(text), 1)
    # Digits read left to right: a date at the start of the text was on the left of the box.
    if match.start() == 0:
        left = right - share * (right - left)
    else:
        right = left + share * (right - left)
    return {**line, "text": rest, "box": (left, top, right, bottom)}


def _is_date(digits: str, shortest: int = 0) -> bool:
    """Is this run of digits a date printed beside the number rather than a piece of it?"""
    if _SLASHED_DATE.match(digits):
        return True
    return bool(_DATE_LIKE.match(digits)) and max(shortest, 1) <= len(digits) <= 8


def _id_field(row: list[dict[str, Any]]) -> tuple[str, float, tuple]:
    # Digits read left to right even on a right-to-left card: the groups are joined by x.
    parts = sorted((line for line in row if _is_number_part(line)), key=lambda item: item["box"][0])
    whole = [line for line in parts if 13 <= len(_digits(line["text"])) <= 15]
    if whole:
        # Read in one piece: that piece is the number, whatever else shares the row.
        parts = [min(whole, key=lambda line: abs(len(_digits(line["text"])) - 14))]
    else:
        # A long date-shaped piece is always the issue date: no 6+ digit stretch of a living
        # holder's number starts 19 or 20.
        parts = [
            line
            for line in parts
            if not _is_date(_digits(line["text"]), shortest=6)
        ] or parts
        undated = [
            line
            for line in parts
            if not _is_date(_digits(line["text"]))
        ]
        # Only drop what looked like a date if what is left can still be the number: a piece of the
        # ID itself can start with 19 or 20 (a month and day, '2012'), and dropping it lost real
        # digits.
        if len("".join(_digits(line["text"]) for line in undated)) >= 12:
            parts = undated
    raw = "".join(_digits(line["text"]) for line in parts)
    return raw, min(line["score"] for line in parts), _union(parts)


def _id_fence(
    row: list[dict[str, Any]], bounds: tuple[float, float, float, float]
) -> tuple[float | None, float | None]:
    """How far a wider re-read of the ID may reach before it reaches the date printed beside it."""
    left, _, right, _ = bounds
    lower = upper = None
    for line in row:
        digits = _digits(line["text"])
        dated = "/" in line["text"] or _is_date(digits, shortest=4)
        if not digits or not dated:
            continue
        box_left, _, box_right, _ = line["box"]
        if box_right <= left + 1:
            lower = box_right if lower is None else max(lower, box_right)
        elif box_left >= right - 1:
            upper = box_left if upper is None else min(upper, box_left)
    return lower, upper


def _is_prose(line: dict[str, Any]) -> bool:
    return _letters(line["text"]) >= 2


def _prose_row(row: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A row's text, or nothing if the row has no Arabic words."""
    if not any(_is_prose(line) for line in row):
        return []
    return [line for line in row if _is_prose(line) or (_digits(line["text"]) and not re.search(r"[A-Za-z]", line["text"]))]


#: Share of the front, from the top of its text to the ID row, that the printed header occupies.
HEADER_SHARE = 0.22


def _centre(row: list[dict[str, Any]]) -> float:
    return float(np.mean([(line["box"][1] + line["box"][3]) / 2.0 for line in row]))


#: How much wider the gap under the header is than the gap below it. On a real card the header's
#: centre sits ~1.4x further from the given name than the given name does from the rest of the
#: name, while with no header the given name is CLOSER to its second row than that row is to the
#: address (~0.75x).
HEADER_GAP = 1.2

#: The fewest text rows a front can keep once the header is cut: two for the name, one address.
MIN_BODY_ROWS = 3


def _header_rows_by_position(
    body: list[list[dict[str, Any]]], id_row: list[dict[str, Any]]
) -> int:
    """How many rows at the top of `body` are the unread header, judged by position alone.

    Position alone is not enough. Measured from the top of the TEXT, the header fills the first
    ~quarter — but only when the header was detected at all. When it was not (glare, blur, a
    distant photo), the top of the text is the given name, and a rule that drops whatever sits in
    the first quarter dropped the given name: 'حسن فؤاد سمير عطية' came back as 'فؤاد سمير عطية'.
    A short given name is hit hardest, because it is alone on its row.

    What does tell the header apart is the gap under it. The given name and the rest of the name
    are the tightest pair of rows on the card, so a header is followed by a gap clearly wider than
    the next one down, and a given name by one that is narrower. A top row counts as header only
    if it lies in the header share, that wider gap follows it, and enough rows stay for a name and
    an address. Otherwise nothing is dropped: keeping a header row costs a stray word the review
    shows, dropping the given name costs the name.
    """
    centres = [_centre(row) for row in body] + [_centre(id_row)]
    top = min(line["box"][1] for line in body[0])
    span = max(centres[-1] - top, 1.0)
    gaps = [b - a for a, b in zip(centres, centres[1:])]
    cut = 0
    for index in range(len(gaps) - 1):
        if (centres[index] - top) / span >= HEADER_SHARE or len(body) - (index + 1) < MIN_BODY_ROWS:
            break
        if gaps[index] > HEADER_GAP * gaps[index + 1]:
            cut = index + 1
    return cut


#: A printed date with its separators read as anything that is not a digit.
_SEPARATED_DATE = re.compile(r"((?:19|20)\d{2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})")


def _as_date(year: str, month: str, day: str) -> str | None:
    import datetime as _dt  # noqa: PLC0415

    try:
        _dt.date(int(year), int(month), int(day))
    except ValueError:
        return None
    return f"{year}{int(month):02d}{int(day):02d}"


def _birth_date(rows: list[list[dict[str, Any]]], id_index: int) -> str | None:
    """The birth date printed beside the front's ID, as YYYYMMDD, if one reads as a real date."""
    for row in rows[max(0, id_index - 1) : id_index + 2]:
        for line in row:
            text = to_western_digits(line["text"])
            match = _SEPARATED_DATE.search(text)
            if match is not None:
                found = _as_date(*match.groups())
                if found:
                    return found
            digits = _digits(text)
            if len(digits) == 10 and _SLASHED_DATE.match(digits):
                found = _as_date(digits[:4], digits[5:7], digits[8:10])
            elif len(digits) == 8 and _DATE_LIKE.match(digits):
                found = _as_date(digits[:4], digits[4:6], digits[6:8])
            else:
                found = None
            if found:
                return found
    return None


#: Where the card's rows sit between the bottom of its title (0) and the top of the ID number (1),
#: measured on every well-read photo here: the given name 0.10-0.18, the rest of the name 0.27-0.37,
#: the address from 0.49. A row centred above NAME_ROW_LIMIT is the name's.
NAME_ROW_LIMIT = 0.43
NAME_SLOTS = (0.145, 0.32)
#: How far from a slot's centre a row still counts as being in it, and how far a probe reaches
#: above and below it (both as shares of the title-to-number span).
SLOT_REACH = 0.09
PROBE_REACH = 0.11
#: Where the text starts, as a share of the image's width: right of the portrait.
TEXT_LEFT_SHARE = 0.30
#: Confidence a probe read needs, and the share of the image's width it must span at least.
PROBE_SCORE = 0.7
PROBE_MIN_WIDTH = 0.04


def _name_geometry(
    rows: list[list[dict[str, Any]]], header: int | None, id_index: int | None
) -> tuple[float, float] | None:
    """(bottom of the title, distance from it to the ID number's top), or None."""
    if header is None or id_index is None:
        return None
    top = max(line["box"][3] for line in rows[header])
    bottom = min(line["box"][1] for line in rows[id_index])
    return (top, bottom - top) if bottom - top > 40 else None


def _known_name_words(text: str) -> bool:
    from .lexicon import _index  # noqa: PLC0415 - the word lists load on first use

    known = _index("name")[0]  # normalized: ى is ي, ة is ه, as the card's reader folds them
    words = normalize_arabic(text).split()
    return bool(words) and all(word in known or word.startswith("عبد") for word in words)


#: Printed text is the darkest thing on the card: a pixel darker than this share of the strip's
#: median is ink, the pyramids, the guilloche and the tint behind the print are not.
PROBE_INK_SHARE = 0.55
PROBE_INK_MAX = 110


def _ink_columns(crop: np.ndarray) -> tuple[int, int] | None:
    """(first, last) column holding printed ink in a probe strip, or None if it holds none."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    dark = gray < min(PROBE_INK_MAX, float(np.median(gray)) * PROBE_INK_SHARE)
    columns = np.flatnonzero(dark.sum(axis=0) >= max(2, int(0.03 * gray.shape[0])))
    return (int(columns[0]), int(columns[-1])) if columns.size else None


def _known_after_one_stray(text: str) -> str | None:
    """`text` with one letter dropped from either end, if that makes it a known name.

    A probe strip still reaches some background, and the recognizer turns a pyramid's edge or a
    guilloche swirl next to a short name into one extra letter: 'هدى' read as 'هدىه'. One stray
    letter at an end is that artefact; a longer difference is a different word.
    """
    words = text.split()
    if not words:
        return None
    # The card prints some names with a gap inside them ('هـ دى'), and the recognizer splits them
    # there: 'هد ى'. Joined, it is the name.
    if len(words) > 1 and _known_name_words("".join(words)):
        return "".join(words)
    for index in (len(words) - 1, 0):
        word = words[index]
        for trimmed in (word[:-1], word[1:]):
            if _letters(trimmed) >= 2:
                candidate = " ".join(words[:index] + [trimmed] + words[index + 1 :])
                if _known_name_words(candidate):
                    return candidate
    return None


def _only_name_one_letter_off(text: str) -> str | None:
    """The one listed name a single word is one letter from (added, lost or changed), else None.

    For a probe's read only: it looks where a given name is printed and nowhere else, so a word
    there one letter off a name is that name misread ('عمرو' read 'صمرو' on a soft phone photo).
    Four letters at least, and exactly one such name: a shorter word is one letter from too many
    ('محد' is 'محمد' and, on a soft photo, also 'مجد'), and two names that close is no answer.
    """
    from .arabic import levenshtein  # noqa: PLC0415 - as in `lexicon.near_miss`
    from .lexicon import _index  # noqa: PLC0415

    words = text.split()
    if len(words) != 1:
        return None
    word = normalize_arabic(words[0])
    if len(word) < 4:
        return None
    known = _index("name")[0]
    close = {
        name for name in known
        if abs(len(name) - len(word)) <= 1 and levenshtein(word, name, limit=1) <= 1
    }
    if len(close) != 1:
        return None
    name = next(iter(close))
    from .lexicon import _names  # noqa: PLC0415 - the name as listed, not its folded form
    return next((listed for listed in _names() if normalize_arabic(listed) == name), name)


def _probe(image: np.ndarray, box: tuple[int, int, int, int], recognizer: object) -> tuple[str, float] | None:
    """Read one strip of the card, on its own, for a word page detection dropped."""
    recognize = getattr(recognizer, "recognize", None)
    left, top, right, bottom = box
    height, width = image.shape[:2]
    left, top, right, bottom = max(0, left), max(0, top), min(width, right), min(height, bottom)
    if recognize is None or right - left < PROBE_MIN_WIDTH * width or bottom - top < 8:
        return None
    strip = image[top:bottom, left:right]
    # The strip runs from the portrait to the text's right edge, so a short given name is a few
    # percent of it and the rest is the pyramids and the guilloche — which the recognizer reads
    # too ('هدى' came back 'هدىه' and was refused). Cut it to the printed ink, keeping a margin of
    # one strip height so a stroke's faint edge stays in. No dark ink at all: nothing is printed.
    span = _ink_columns(strip)
    if span is None:
        return None
    pad = bottom - top
    strip = strip[:, max(0, span[0] - pad) : min(strip.shape[1], span[1] + pad + 1)]
    crop = cv2.resize(strip, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    try:
        out = recognize(crop, rtl=True)
    except Exception:  # noqa: BLE001 - a probe is a second chance, never a reason to fail
        return None
    text = " ".join(out.text.split())
    if _letters(text) < 2 or _DIGIT.search(to_western_digits(text)) or re.search(r"[A-Za-z]", text):
        return None
    # A name the card could carry is believed at the model's usual confidence; anything else needs
    # to be read nearly perfectly, or it is the pattern behind the print and not a word.
    if _known_name_words(text):
        return (text, float(out.score)) if out.score >= PROBE_SCORE else None
    cleaned = _known_after_one_stray(text)
    if cleaned is not None:
        return (cleaned, float(out.score)) if out.score >= PROBE_SCORE else None
    if out.score >= PROBE_SCORE:
        nearest = _only_name_one_letter_off(text)
        if nearest is not None:
            return (nearest, float(out.score))
    return (text, float(out.score)) if out.score >= 0.9 else None


def _recover_name(image: np.ndarray, read: RowRead, recognizer: object) -> None:
    """Put back a given name, or the last words of the name, that page detection dropped.

    Short words at the end of a printed line are what the detector loses (a three-letter name
    after four others, a given name alone above the rest): the box is never made, so no recognizer
    ever sees them. The name's rows are at known places between the title and the number, so the
    places where a row or the end of one is missing are read directly.
    """
    geo = read.name_geo
    if geo is None or "fullNameAr" not in read.fields:
        return
    top, span, right, text_left = geo["top"], geo["span"], geo["right"], geo["left"]
    width = image.shape[1]
    limit = int(min(TEXT_LEFT_SHARE * width, text_left))
    placed: list[tuple[float, str, float]] = []  # (centre, text, score)
    taken: set[int] = set()
    for centre in NAME_SLOTS:
        slot = [
            (i, row) for i, row in enumerate(geo["rows"])
            if i not in taken and abs((_centre(row) - top) / span - centre) <= SLOT_REACH
        ]
        y0, y1 = int(top + (centre - PROBE_REACH) * span), int(top + (centre + PROBE_REACH) * span)
        if not slot:
            found = _probe(image, (limit, y0, int(right) + 2, y1), recognizer)
            if found is not None:
                placed.append((centre, found[0], found[1]))
            continue
        i, row = slot[0]
        taken.add(i)
        row_left = int(min(line["box"][0] for line in row))
        text = _rtl_text(row)
        score = float(np.mean([line["score"] for line in row]))
        found = _probe(image, (limit, y0, row_left - 2, y1), recognizer)
        if found is not None:
            text, score = f"{text} {found[0]}", (score + found[1]) / 2
        placed.append((centre, text, score))
    for i, row in enumerate(geo["rows"]):
        if i not in taken:  # a row between the slots: kept, in its place
            placed.append(((_centre(row) - top) / span, _rtl_text(row), float(np.mean([l["score"] for l in row]))))
    placed.sort(key=lambda item: item[0])
    text = " ".join(item[1] for item in placed).strip()
    if not text or text == read.fields["fullNameAr"][0].strip():
        return
    _, y_top, _, y_bottom = read.fields["fullNameAr"][2]
    read.fields["fullNameAr"] = (
        text,
        float(np.mean([item[2] for item in placed])),
        (float(limit), min(y_top, top + 0.05 * span), float(right), y_bottom),
    )
    read.recovered_name = True


def _front(rows: list[list[dict[str, Any]]], out: RowRead) -> None:
    id_index = _id_row(rows)
    if id_index is not None:
        out.fields["nationalId"] = _id_field([_undated(line) for line in rows[id_index]])
        out.birth = _birth_date(rows, id_index)

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
        # garbled header would be taken for the first name. Find it by position instead.
        cut = _header_rows_by_position(body, rows[id_index])
        body = body[cut:]
        if cut:
            # Found by position, it still marks where the name's rows are: without it the search
            # for a given name the detector dropped never ran on exactly the blurred photos that
            # drop one.
            header = cut - 1
    text_rows = [_prose_row(row) for row in body]
    text_rows = [row for row in text_rows if row]
    if not text_rows:
        return

    # A real card prints the name on two rows (given name, then the rest) and the address below.
    geometry = _name_geometry(rows, header, id_index)
    if geometry is not None:
        # Which rows are the name is a matter of where they are between the title and the number,
        # not of how many rows were detected: a given name the detector dropped left the first
        # address row to be taken for the second half of the name.
        top, span = geometry
        names = [row for row in text_rows if (_centre(row) - top) / span < NAME_ROW_LIMIT]
        if names:
            split = len(names)
            text_rows = names + [row for row in text_rows if row not in names]
            out.name_geo = {
                "top": top,
                "span": span,
                "rows": [[line for line in row if _is_prose(line)] for row in names],
                "right": max(line["box"][2] for row in text_rows for line in row),
                "left": min(line["box"][0] for row in text_rows for line in row),
            }
        else:
            geometry = None
    if geometry is None:
        second_is_address = len(text_rows) > 1 and any(_looks_like_address(line["text"]) for line in text_rows[1])
        split = 2 if len(text_rows) >= 3 and not second_is_address else 1
    # A name has no digits, so a number on a name row is background noise read as text; only the
    # address keeps its numbers (see `_prose_row`).
    name_rows = [[line for line in row if _is_prose(line)] for row in text_rows[:split]]
    for name, chosen in (("fullNameAr", name_rows), ("address", text_rows[split:])):
        read = _text_field(chosen)
        if read is not None:
            out.fields[name] = read


def _looks_like_address(text: str) -> bool:
    """A digit, an address word, or a hyphen joining two places: no name has any of them."""
    if _DIGIT.search(to_western_digits(text)) or "-" in text:
        return True
    tokens = text.split()
    if any(rasm_fold(token) in _ADDRESS_WORDS for token in tokens):
        return True
    return any(
        word in normalize_arabic(token) and len(token) > len(word)
        for token in tokens
        for word in _GLUED_ADDRESS_WORDS
    )


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
        out.fields["nationalId"] = _id_field([_undated(line) for line in rows[id_index]])
        out.fences["nationalId"] = _id_fence(rows[id_index], out.fields["nationalId"][2])
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
    """The religion word when blur has left too little of it to match: read from where it sits."""
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
    """The vocabulary word among these tokens: exact first, then one edit away."""
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
# when the read of the photo as given came back weak, a clean close-up pays nothing.

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
    except Exception:  # noqa: BLE001 - a failed extra pass costs the pass, not the card
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
    except Exception:  # noqa: BLE001 - a failed read costs the card's rows, never the request
        return []


def _as_line_dicts(found: list[tuple[object, str, float]]) -> list[dict[str, Any]]:
    return [
        {"text": text.strip(), "score": float(score), "box": _bounds(poly)}
        for poly, text, score in found
    ]


def _skew(found: list[tuple[object, str, float]]) -> float | None:
    """The card's tilt in degrees, from the slope of its long lines. None if level enough."""
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
    # Generous, because the rows the first read missed are exactly the ones this pass is for, and
    # they lie outside the union of the ones it found, on a far-away back the whole ID row did.
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
    """Each field from the read that got it best: a sound value first, then the higher score."""
    merged = RowRead(
        lines=reads[0].lines,
        pass_lines=[line for read in reads[1:] for line in (*read.lines, *read.pass_lines)],
        rows=reads[0].rows,
        passes=[label for read in reads for label in read.passes],
        issue_year=next((read.issue_year for read in reads if read.issue_year), None),
        birth=next((read.birth for read in reads if read.birth), None),
    )
    # The name and the address are cut from the same run of rows (where one ends the other
    # begins), so they must come from the same read.
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
            if name in best.fences:
                merged.fences[name] = best.fences[name]
    for name in {name for read in reads for name in read.fields} - set(merged.fields):
        best = max(
            (read for read in reads if name in read.fields),
            key=lambda read: (_sound(name, read.fields[name][0]), read.fields[name][1]),
        )
        merged.fields[name] = best.fields[name]
        merged.images[name] = best.images[name]
        if name in best.fences:
            merged.fences[name] = best.fences[name]
    return merged


def _as_dicts(read: RowRead) -> list[dict[str, Any]]:
    return [
        {"text": text, "score": score, "box": _bounds(poly)} for poly, text, score in read.lines
    ]


def read_by_rows(
    image: np.ndarray, side: str, recognizer: object, *, retry: bool = True
) -> RowRead | None:
    """Read every line on this side and assign the fields. None if the recognizer cannot.

    `retry=False` reads once even when fields are missing: for a photo the quality gate already
    rejected, where a zoomed and an enhanced read again only spend time (25 s on a live card).
    """
    read = getattr(recognizer, "read_page", None)
    if read is None:
        return None
    # The tilt is measured on a full read, not on the quick one the orientation check made: tried,
    # the quick read's tilt levelled a real card it should not have, and its name and address each
    # lost a letter, for about a second saved.
    found = _polys(image, read)
    angle = _skew(found)
    if angle is not None:
        image = _level(image, angle)
        reads = [_assign(image, side, _lines(image, read), f"levelled {angle:+.1f}°")]
    else:
        reads = [_assign(image, side, _as_line_dicts(found), "photo")]
    if side == "back":
        _read_religion_gap(image, reads[0], recognizer)
    else:
        _recover_name(image, reads[0], recognizer)
    if not _weak(reads[0], side) or not retry:
        return reads[0]

    base = image
    zoomed = _zoom(image, _as_dicts(reads[0]))
    if zoomed is not None:
        base, scale = zoomed
        reads.append(_assign(base, side, _lines(base, read), f"zoomed x{scale:.1f}"))
        if side == "back":
            _read_religion_gap(base, reads[-1], recognizer)
        else:
            _recover_name(base, reads[-1], recognizer)
        if not _weak(reads[-1], side):
            return _merge(reads)

    enhanced = _enhance(base)
    reads.append(_assign(enhanced, side, _lines(enhanced, read), "enhanced"))
    if side == "back":
        _read_religion_gap(enhanced, reads[-1], recognizer)
    else:
        _recover_name(enhanced, reads[-1], recognizer)
    return _merge(reads)
