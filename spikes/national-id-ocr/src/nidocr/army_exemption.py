"""The Army Exemption Certificate (شهادة الإعفاء من الخدمة العسكرية): format and consistency only.

How a photo is read:
1. Turned upright by the certificate's own printed words, which only read the right way up
   (`upright_certificate`), then read as a page of lines with their boxes.
2. Fields found by place in the form's table: beside their label (name, birth date, date written),
   in the cell under it (military number, national ID, decision code, number and date), or as a
   sentence (the decision). The military number's three digit groups are read group by group.
3. Names and decision words corrected from word lists; the decision's ground classified.
4. Consistency checks (`_checks`): parts of the certificate that must agree with each other.

It can say the photo has this certificate's layout and that its parts agree. It can never say a
certificate is genuine: only the issuing authority can, and the UI says so.

Labels, layouts and word lists are not written here. They come from
`profiles/documents/army-exemption.json`, measured on real certificates. Without that profile the
reader still tells a National ID Card or an EGY CASH ID apart (`not_match`) and answers
`reader_not_configured` for anything else.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from .arabic import levenshtein, rasm_fold, to_western_digits
from .document import read_document
from .egycash_id import _is_company
from .governorates import GOVERNORATES_AR, match_governorate
from .nid import is_structurally_valid
from .portrait import face_fills_frame as _face_fills_frame
from .preprocess import load_bgr
from .verdict import Verdict

DOCUMENT_TYPE = "army_exemption"
DEFAULT_PROFILE = Path(__file__).resolve().parents[2] / "profiles" / "documents" / "army-exemption.json"

#: The National ID Card's title words (see extract._TITLE_WORDS), folded the same way.
_NID_TITLE = frozenset(rasm_fold(word) for word in ("بطاقة", "تحقيق", "الشخصية"))
#: Words only the National ID Card's back prints (sex, religion, marital status), as extract.py's.
_NID_BACK = frozenset(
    rasm_fold(word)
    for word in ("ذكر", "أنثى", "مسلم", "مسلمة", "مسيحي", "مسيحية", "أعزب", "عزباء", "متزوج", "متزوجة",
                 "مطلق", "مطلقة", "أرمل", "أرملة")
)
_DIGITS = re.compile(r"\d+")
_DATE = re.compile(r"(\d{1,4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,4})")


#: A photo whose long side is under this is enlarged before reading: the print is small, and real
#: photos have arrived as narrow as 537 px.
MIN_READ_SIDE = 1300
READ_SIDE = 1400


@dataclass
class ExemptionProfile:
    """Measured on sample certificates. Every list is empty until samples exist."""

    #: Words printed on every certificate (title, issuing body). Any of their spellings, folded.
    title_words: list[str] = field(default_factory=list)
    #: How many different title words must be read for the layout to count as present.
    min_title_words: int = 2
    #: field name → the labels printed before its value on the certificate.
    fields: dict[str, list[str]] = field(default_factory=dict)
    #: field name → where its value sits and what it looks like: {layout: inline | below | paragraph,
    #: kind: name | date | digits | nationalId | text, minDigits, keywords}. Missing: inline text.
    specs: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: A title word → the kind of exemption it names (final, temporary).
    exemption_types: dict[str, str] = field(default_factory=dict)
    #: Field names that must be found for `match`.
    required: list[str] = field(default_factory=list)
    #: Earliest plausible issue year; the latest is today.
    earliest_year: int = 1950
    #: field → the number field it is printed under (where that number was issued).
    issuers: dict[str, str] = field(default_factory=dict)
    #: The header words before the recruitment area's name ("منطقة تجنيد").
    recruitment_area_labels: list[str] = field(default_factory=list)
    #: The article's part named in the title ("البند أولاً") → {value, type}.
    clauses: dict[str, dict[str, str]] = field(default_factory=dict)
    #: The words decisions are written in, to correct a decision read with letters off.
    decision_words: list[str] = field(default_factory=list)
    #: Exemption grounds, in the order they are tried: {id, type, all, any, ar, en}.
    reasons: list[dict[str, Any]] = field(default_factory=list)

    @property
    def configured(self) -> bool:
        return bool(self.title_words and self.fields)

    def spec(self, name: str) -> dict[str, Any]:
        return {"layout": "inline", "kind": "text", **self.specs.get(name, {})}


def load_profile(path: str | os.PathLike | None = None) -> ExemptionProfile:
    """The measured profile, or an empty one (reader not configured) if there is none."""
    location = Path(path or os.environ.get("OCR_EXEMPTION_PROFILE") or DEFAULT_PROFILE)
    if not location.is_file():
        return ExemptionProfile()
    data = json.loads(location.read_text(encoding="utf-8"))
    labels: dict[str, list[str]] = {}
    specs: dict[str, dict[str, Any]] = {}
    for name, entry in (data.get("fields") or {}).items():
        if isinstance(entry, dict):  # {labels, layout, kind, ...}
            labels[name] = list(entry.get("labels", []))
            specs[name] = {key: value for key, value in entry.items() if key != "labels"}
        else:  # a plain list of labels: printed before the value, on its row
            labels[name] = list(entry)
    return ExemptionProfile(
        title_words=list(data.get("titleWords", [])),
        min_title_words=int(data.get("minTitleWords", 2)),
        fields=labels,
        specs=specs,
        exemption_types=dict(data.get("exemptionTypes") or {}),
        required=list(data.get("required", [])),
        earliest_year=int(data.get("earliestYear", 1950)),
        issuers=dict(data.get("issuers") or {}),
        recruitment_area_labels=list(data.get("recruitmentAreaLabels", [])),
        clauses=dict(data.get("clauses") or {}),
        reasons=list(data.get("reasons") or []),
        decision_words=list(data.get("decisionWords") or []),
    )


def _fold_tokens(text: str) -> list[str]:
    return [rasm_fold(token.strip("-–—:.,،()/")) for token in text.split()]


def _same_word(token: str, word: str) -> bool:
    return token == word or (len(word) > 4 and levenshtein(token, word, limit=1) <= 1)


def _hits(lines: list[str], words: list[str] | frozenset[str]) -> int:
    wanted = {rasm_fold(word) for word in words}
    found = {
        word
        for text in lines
        for token in _fold_tokens(text)
        for word in wanted
        if _same_word(token, word)
    }
    return len(found)


def _label_value(rows: list[str], labels: list[str]) -> str | None:
    """The text after a label on its row, or the next row when the label stands alone."""
    folded_labels = [_fold_tokens(label) for label in labels]
    for index, row in enumerate(rows):
        tokens = row.split()
        folded = _fold_tokens(row)
        for label in folded_labels:
            for start in range(len(folded) - len(label) + 1):
                if folded[start : start + len(label)] == label:
                    rest = " ".join(tokens[start + len(label) :]).strip(" :-")
                    if rest:
                        return rest
                    if index + 1 < len(rows):
                        return rows[index + 1].strip()
    return None


def _date_splits(run: str, slashes: tuple[str, ...] = ("1", "7", *"02345689")) -> list[tuple[str, str, str]]:
    """Ways a run of digits can be a year-month-day whose slashes were misread.

    On real certificates a "/" is read as the digit 1 (1995/03/14 → 1995103114), or dropped (one of
    them → nine digits, both → eight)."""
    splits: list[tuple[str, str, str]] = []
    # On real photos "/" comes back as 1, as 7 (the Arabic ٧ is a slanted stroke), or as a copy of the
    # digit beside it. Any digit is tried last, and only after a plausible year.
    for slash in slashes:
        if slash not in "17" and not re.match(r"(19|20)\d\d", run):
            continue
        if len(run) == 10 and run[4] in ("1", slash) and run[7] in ("1", slash):
            splits.append((run[:4], run[5:7], run[8:10]))
        if len(run) == 9:
            if run[4] == slash:
                splits.append((run[:4], run[5:7], run[7:9]))
            if run[6] == slash:
                splits.append((run[:4], run[4:6], run[7:9]))
    if len(run) == 8:
        splits.append((run[:4], run[4:6], run[6:8]))
    return splits


def _date_is_guessed(text: str) -> bool:
    """Whether the date was only found by taking a digit other than 1 for one of its slashes."""
    when = _parse_date(text)
    if when is None:
        return False
    plain = "".join(re.findall(r"\d+", to_western_digits(text)))
    if _DATE.search(to_western_digits(text)) or len(plain) == 8:
        return False
    return not any(_date_splits_with(plain, ("1",)))


def _date_splits_with(run: str, slashes: tuple[str, ...]) -> list[date]:
    found = []
    for year, month, day in _date_splits(run, slashes):
        try:
            found.append(date(int(year), int(month), int(day)))
        except ValueError:
            continue
    return found


def _parse_date(text: str) -> date | None:
    western = to_western_digits(text)
    # A slash read as one letter between digits is still a slash.
    western = re.sub(r"(?<=\d)[^\d\s/\-.](?=\d)", "/", western)
    match = _DATE.search(western)
    if match:
        parts = [int(part) for part in match.groups()]
        year, month, day = (parts[0], parts[1], parts[2]) if parts[0] > 31 else (parts[2], parts[1], parts[0])
        try:
            return date(year, month, day)
        except ValueError:
            return None
    # A slash read as "1" or lost; one kept slash between runs is only a separator (201602/21 is
    # 2016/02/21).
    runs = re.findall(r"(?<!\d)\d{8,10}(?!\d)", western)
    runs += ["".join(part) for part in re.findall(r"(?<![\d/])(\d{2,7})\s*/\s*(\d{2,7})(?![\d/])", western)
             if 8 <= len("".join(part)) <= 10]
    for run in runs:
        for year, month, day in _date_splits(run):
            if 1900 <= int(year) <= 2100:
                try:
                    return date(int(year), int(month), int(day))
                except ValueError:
                    continue
    return None


#: Distinct printed form words read as given at which a certificate counts as upright, unread
#: any other way. An upright certificate reads 6 or more; upside down or sideways, none or one.
UPRIGHT_FORM_WORDS = 4
#: The lead in form words another way up needs over the photo as given, and its least count.
TURN_LEAD = 2
TURN_MIN_WORDS = 3
#: Long side the orientation reads run at: the print stays readable, each read stays quick.
ORIENT_LONG_SIDE = 1400


def _form_vocabulary(profile: ExemptionProfile) -> set[str]:
    words = list(profile.title_words) + [word for labels in profile.fields.values() for label in labels
                                         for word in label.split()]
    return {rasm_fold(word) for word in words if len(word) >= 3}


def _form_hits(lines: list, vocabulary: set[str]) -> int:
    found = set()
    for _, text, _ in lines:
        for token in _fold_tokens(str(text)):
            for word in vocabulary:
                if _same_word(token, word):
                    found.add(word)
    return len(found)


def upright_certificate(image: Any, recognizer: Any, profile: ExemptionProfile | None = None) -> tuple[Any, int, list]:
    """→ (the photo upright, the clockwise turn applied, its detected lines as (box, text, score)).

    The certificate's own printed words say which way is up: they are only read the right way up,
    while a worn certificate reads at a low confidence however it lies, and digits read almost as
    well upside down (measured: the general check turned upright certificates). The photo is turned
    only when another way up reads clearly more of them."""
    from .orientation import _mean_score, _sideways, turn  # noqa: PLC0415

    profile = profile or load_profile()
    vocabulary = _form_vocabulary(profile)
    read = getattr(recognizer, "detect_lines", None)
    if getattr(recognizer, "read_page", None) is not None:
        # The page reader on a copy fitted to ORIENT_LONG_SIDE: the detector's own canvas is landscape,
        # and a certificate on its side would shrink in it until its words could not be read.
        import cv2  # noqa: PLC0415

        def read(view: Any) -> list:
            scale = min(1.0, ORIENT_LONG_SIDE / max(view.shape[:2]))
            small = view if scale == 1.0 else cv2.resize(view, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            return recognizer.read_page(small)
    if read is None:
        return image, 0, []
    try:
        given = list(read(image))
    except Exception:  # noqa: BLE001 - orientation is an improvement, never a reason to fail
        return image, 0, []
    given_hits = _form_hits(given, vocabulary)
    if _sideways(given):
        # Lines running down the page: it lies on its side, whatever its words say (the page reader
        # turns tall line boxes itself, and reads their words right). One of the two turns is right:
        # the one that reads more form words, then more confidently.
        reads = []
        for degrees in (90, 270):
            view = turn(image, degrees)
            try:
                lines = list(read(view))
            except Exception:  # noqa: BLE001
                continue
            reads.append((_form_hits(lines, vocabulary), _mean_score(lines), degrees, lines, view))
        if reads:
            _, _, degrees, lines, view = max(reads, key=lambda item: (item[0], item[1]))
            return view, degrees, lines
        return image, 0, given
    if given_hits >= UPRIGHT_FORM_WORDS:
        return image, 0, given
    best = (given_hits, 0, given, image)
    for degrees in (180, 90, 270):
        view = turn(image, degrees)
        try:
            lines = list(read(view))
        except Exception:  # noqa: BLE001
            continue
        hits = _form_hits(lines, vocabulary)
        if hits > best[0]:
            best = (hits, degrees, lines, view)
        if hits >= UPRIGHT_FORM_WORDS and hits >= given_hits + TURN_LEAD:
            break
    hits, degrees, lines, view = best
    if degrees and hits >= TURN_MIN_WORDS and hits >= given_hits + TURN_LEAD:
        return view, degrees, lines
    return image, 0, given


def rtl_groups(text: str) -> str:
    """Digit groups read left to right off the page, put in Arabic reading order (right to left)."""
    runs = _DIGITS.findall(to_western_digits(text or ""))
    return "".join(reversed(runs))


def split_groups(image: Any, expected: int, text_height: float | None = None) -> list[list[tuple[int, int]]]:
    """Where a row's digit groups lie (left to right on the page), as candidate splits.

    Two ways, because neither is right on every sample: groups are wherever a gap is wider than a
    digit's height, or between the `expected - 1` widest gaps. Arabic zeros are dots, and the gaps
    round them can be as wide as the gaps between groups. Coloured ink (a stamp, a marker) and specks
    far from the digits are not part of the number; the table's rules are removed first."""
    import cv2  # noqa: PLC0415 - the pipeline has it loaded already
    import numpy as np  # noqa: PLC0415

    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height = grey.shape[0]
    block = max(15, (height // 2) * 2 + 1)
    ink = cv2.adaptiveThreshold(grey, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, 12)
    rules = cv2.bitwise_or(
        cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(3, int(height * 0.8))))),
        cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, int(height * 1.5)), 1))),
    )
    ink = cv2.subtract(ink, rules)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    coloured = ((hsv[..., 1] > 90) & (hsv[..., 2] > 60)).astype(np.uint8) * 255
    ink = cv2.subtract(ink, cv2.dilate(coloured, np.ones((3, 3), np.uint8)))

    if not text_height:  # the detected row's height when known: the crop's own ink includes noise
        rows = np.flatnonzero((ink > 0).sum(axis=1) > 1)
        text_height = float(rows[-1] - rows[0] + 1) if rows.size else float(height)
    columns = (ink > 0).sum(axis=0) > 1
    runs: list[list[int]] = []
    start = None
    for x, on in enumerate([*columns.tolist(), False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append([start, x])
            start = None
    # A speck thinner than a tenth of the text is no digit (an Arabic zero's dot is about a fifth).
    runs = [run for run in runs if run[1] - run[0] >= max(2.0, 0.1 * text_height)
            or int((ink[:, run[0]:run[1]] > 0).sum()) > 0.04 * text_height ** 2]
    # Ink far from the rest (a speck, a mark at the cell's edge) is not the number: keep the cluster
    # of runs with the most ink, clusters being split where a gap is over 2.5 text heights.
    far = 2.5 * text_height
    clusters: list[list[list[int]]] = []
    for run in runs:
        if clusters and run[0] - clusters[-1][-1][1] <= far:
            clusters[-1].append(run)
        else:
            clusters.append([run])
    runs = max(clusters, key=lambda cluster: sum(b - a for a, b in cluster)) if clusters else []
    if not runs:
        return []

    splits: list[list[tuple[int, int]]] = []
    by_gap: list[list[int]] = []
    for run in runs:
        if by_gap and run[0] - by_gap[-1][1] < 0.9 * text_height:
            by_gap[-1][1] = run[1]
        else:
            by_gap.append(list(run))
    splits.append([(a, b) for a, b in by_gap])
    if len(runs) >= expected:
        # Every choice of cuts among the widest gaps (a gap between groups is wide, not always the
        # widest): the reads decide, as only a split whose every group reads at its printed length
        # is kept (see `extract_exemption`).
        from itertools import combinations  # noqa: PLC0415

        widest = sorted(range(len(runs) - 1), key=lambda i: runs[i + 1][0] - runs[i][1], reverse=True)[: expected + 1]
        for cuts in combinations(sorted(widest), expected - 1):
            begin, split = 0, []
            for index in [*cuts, len(runs) - 1]:
                split.append((runs[begin][0], runs[index][1]))
                begin = index + 1
            if split not in splits:
                splits.append(split)
    # A group of digits is never narrower than most of one digit's height.
    splits = [split for split in splits if all(b - a >= 0.8 * text_height for a, b in split)] or splits[:1]
    return sorted(splits, key=lambda split: len(split) != expected)


def pick_number(candidates: list[str | None], lengths: list[int]) -> tuple[str | None, bool]:
    """Of several reads of a grouped number, the one of the printed length most of them give, and
    whether at least two reads gave it. A read of another length is never chosen."""
    from collections import Counter  # noqa: PLC0415

    total = sum(lengths)
    fitting = Counter(candidate for candidate in candidates if candidate and len(candidate) == total)
    if not fitting:
        return None, False
    value, support = fitting.most_common(1)[0]
    return value, support >= 2


def _place_words() -> dict[str, str]:
    from .lexicon import _ADDRESS_WORDS, _DISTRICTS  # noqa: PLC0415 - only needed here

    words = set(_ADDRESS_WORDS) | set(_DISTRICTS)
    for name in GOVERNORATES_AR.values():
        words.update(name.split())
    return {rasm_fold(word): word for word in words if len(word) >= 3}


_PLACES: dict[str, str] | None = None


def clean_place(text: str) -> str:
    """Where a number was issued, as printed: "ق." (قسم) or "م." (مركز), then the place, each word
    snapped to a known district when it is one letter off one, and only one."""
    global _PLACES  # noqa: PLW0603 - built once, on first use
    if _PLACES is None:
        _PLACES = _place_words()
    words = [word.strip(".,:،؛-ـ") for word in re.split(r"[\s.,،]+", text.replace("ـ", "")) if word.strip(".,:،؛-ـ")]
    prefix = ""
    if words and len(words[0]) <= 2 and words[0][0] in "قم":
        prefix = words.pop(0)[0] + "."
    snapped = []
    for word in words:
        folded = rasm_fold(word)
        if folded not in _PLACES and len(word) >= 4:
            near = [place for key, place in _PLACES.items() if levenshtein(folded, key, limit=1) <= 1]
            word = near[0] if len(near) == 1 else word
        snapped.append(_PLACES.get(rasm_fold(word), word))
    return prefix + " ".join(snapped)


def correct_form_text(text: str, profile: ExemptionProfile) -> str:
    """The decision with each misread word put back to the form word it is closest to, when exactly
    one form word is that close: the same letter skeleton (a dot lost or added), or one letter off
    (two on a long word: ع and س merged into ص turned العسكرية into الصكرية). A word near no form
    word, or near two, is left as read (a name, a date)."""
    from .arabic import normalize_arabic  # noqa: PLC0415

    vocabulary = {normalize_arabic(word): word for word in profile.decision_words}
    skeletons: dict[str, set[str]] = {}
    for key, word in vocabulary.items():
        skeletons.setdefault(rasm_fold(key), set()).add(word)
    out = []
    for token in text.split():
        core = token.strip(".,:،؛()-")
        key = normalize_arabic(core)
        if not core or key in vocabulary or len(key) < 4 or re.search(r"\d", to_western_digits(core)):
            out.append(token)
            continue
        same = skeletons.get(rasm_fold(key), set())
        if len(same) == 1:
            out.append(token.replace(core, next(iter(same))))
            continue
        limit = 2 if len(key) >= 7 else 1
        near = {vocabulary[other] for other in vocabulary
                if abs(len(other) - len(key)) <= limit and levenshtein(key, other, limit=limit) <= limit}
        out.append(token.replace(core, next(iter(near))) if len(near) == 1 else token)
    return " ".join(out)


def classify_reason(text: str, profile: ExemptionProfile) -> tuple[str, str | None, str, str]:
    """The exemption's ground from the decision's words: (id, the kind the law gives it, Arabic, English).

    A summary for a person to check against the sentence itself, which is always shown with it."""
    tokens = _fold_tokens(to_western_digits(text))

    def has(word: str) -> bool:
        folded = rasm_fold(word)
        return any(_same_word(token, folded) for token in tokens)

    for reason in profile.reasons:
        if all(has(word) for word in reason.get("all", [])) and (
            not reason.get("any") or any(has(word) for word in reason["any"])
        ):
            return reason["id"], reason.get("type"), reason.get("ar", ""), reason.get("en", "")
    words = text.split()
    return "other", None, " ".join(words[:12]), "Not recognised: read the decision itself"


def _plausible_date(text: str, earliest_year: int, today: date | None = None) -> bool:
    today = today or date.today()
    when = _parse_date(text)
    return when is not None and date(earliest_year, 1, 1) <= when <= today


@dataclass
class ExemptionRead:
    fields: dict[str, dict[str, Any]]
    evidence: dict[str, Any]
    verdict: Verdict


def _screen(rows: list[str], profile: ExemptionProfile, face_fills_frame: bool) -> tuple[dict[str, Any], Verdict | None]:
    """The checks made before reading any field: is this some other document, or nothing at all?"""
    evidence: dict[str, Any] = {
        "lines": len(rows),
        "nationalIdTitleWords": _hits(rows, _NID_TITLE),
        "nationalIdBackWords": len({token for row in rows for token in _fold_tokens(row)} & _NID_BACK),
        "companyName": any(_is_company(row) for row in rows),
        "configured": profile.configured,
    }
    if face_fills_frame and len(rows) <= 2:
        return evidence, Verdict(DOCUMENT_TYPE, "not_match", ("looks_like_a_face",))
    if not rows:
        return evidence, Verdict(DOCUMENT_TYPE, "unreadable", ("no_text",))
    if evidence["companyName"]:
        return evidence, Verdict(DOCUMENT_TYPE, "not_match", ("looks_like_egycash_id",))
    if evidence["nationalIdTitleWords"] >= 2 or evidence["nationalIdBackWords"] >= 2:
        return evidence, Verdict(DOCUMENT_TYPE, "not_match", ("looks_like_national_id",))
    if not profile.configured:
        return evidence, Verdict(DOCUMENT_TYPE, "unreadable", ("reader_not_configured",))
    return evidence, None


def _birth_from_national_id(number: str) -> date | None:
    """Digits 1–7 of a national ID: century (2 → 1900s, 3 → 2000s), then YYMMDD."""
    century = {"2": 1900, "3": 2000}.get(number[:1])
    if century is None or len(number) < 7:
        return None
    try:
        return date(century + int(number[1:3]), int(number[3:5]), int(number[5:7]))
    except ValueError:
        return None


def _judge(
    fields: dict[str, dict[str, Any]],
    evidence: dict[str, Any],
    rows: list[str],
    profile: ExemptionProfile,
    holder: dict[str, str] | None,
    today: date | None,
) -> Verdict:
    """Format and consistency, never authenticity: the reasons a certificate is not a clean match."""
    title = _hits(rows, profile.title_words)
    evidence["titleWords"] = title
    reasons: list[str] = []
    number = fields.get("nationalId")
    if number is not None:
        digits = "".join(_DIGITS.findall(to_western_digits(number["value"])))
        number["value"] = digits
        number["valid"] = len(digits) == 14 and is_structurally_valid(digits)
        if not number["valid"]:
            number["confidence"] = "low"
            reasons.append("national_id_invalid")
    for name, data in fields.items():
        if name.endswith("Date") and not _plausible_date(data["value"], profile.earliest_year, today):
            data["confidence"] = "low"
            reasons.append("date_implausible")

    # Dates that must agree: the birth date with the national ID's own digits, and a decision taken
    # after the holder was born. Decision-before-issue is deliberately not checked: a real
    # certificate carried a decision dated after the date printed as the certificate's.
    born = _parse_date(fields["birthDate"]["value"]) if "birthDate" in fields else None
    if born and number is not None and number.get("valid"):
        if _birth_from_national_id(number["value"]) != born:
            fields["birthDate"]["confidence"] = "low"
            reasons.append("birth_date_disagrees_with_national_id")
    decided = _parse_date(fields["decisionDate"]["value"]) if "decisionDate" in fields else None
    if born and decided and decided < born:
        reasons.append("dates_out_of_order")

    checks = _checks(fields, number, born, decided, profile)
    evidence["checks"] = checks
    reasons += [item["reason"] for item in checks if item["strong"] and item["result"] == "fail"]

    if holder:
        if holder.get("nationalId") and number is not None and number["value"] != holder["nationalId"]:
            reasons.append("national_id_disagrees_with_card")
        name = fields.get("fullNameAr")
        if holder.get("fullNameAr") and name is not None:
            ours, theirs = rasm_fold(name["value"]), rasm_fold(holder["fullNameAr"])
            if levenshtein(ours, theirs, limit=3) > 2:
                reasons.append("name_disagrees_with_card")

    if title < profile.min_title_words:
        if len(rows) >= 8:
            return Verdict(DOCUMENT_TYPE, "not_match", ("no_certificate_structure",))
        return Verdict(DOCUMENT_TYPE, "unreadable", tuple(["no_certificate_structure"] + reasons))
    missing = [f"{name}_missing" for name in profile.required if name not in fields]
    # Read, but too poorly to rely on (a noisy name, two reads of a number that disagree).
    missing += [f"{name}_unclear" for name in profile.required if fields.get(name, {}).get("confidence") == "low"
                and not (name == "nationalId" and "national_id_invalid" in reasons)]
    if missing or reasons:
        return Verdict(DOCUMENT_TYPE, "unreadable", tuple(dict.fromkeys(missing + reasons)))
    return Verdict(DOCUMENT_TYPE, "match", ())


_CODE_OF = {name: code for code, name in GOVERNORATES_AR.items()}


def _checks(
    fields: dict[str, dict[str, Any]],
    number: dict[str, Any] | None,
    born: date | None,
    decided: date | None,
    profile: ExemptionProfile,
) -> list[dict[str, Any]]:
    """Parts of the certificate that must agree with each other. Each is `pass`, `fail` or `unknown`
    (its parts were not read). A `strong` one failing is a reason the certificate is not a clean
    match; a weak one is shown for a person to look at. None of them, passed, proves anything about
    where the paper came from: only the issuing authority can confirm that."""
    out: list[dict[str, Any]] = []

    def add(name: str, result: bool | None, strong: bool, reason: str) -> None:
        out.append({"id": name, "result": "unknown" if result is None else "pass" if result else "fail",
                    "strong": strong, "reason": reason})

    kind = fields.get("exemptionType", {}).get("value")
    nid_ok = number is not None and number.get("valid")
    add("national_id_valid", None if number is None else bool(nid_ok), True, "national_id_invalid")
    add("birth_matches_national_id",
        None if not (born and nid_ok) else _birth_from_national_id(number["value"]) == born,
        True, "birth_date_disagrees_with_national_id")
    add("decision_after_birth", None if not (born and decided) else decided >= born, True, "dates_out_of_order")

    clause_type = fields.get("legalClause", {}).get("type")
    add("type_matches_clause", None if not (kind and clause_type) else kind == clause_type,
        True, "type_disagrees_with_clause")

    decision = fields.get("decision", {}).get("value")
    worded = None
    if decision:
        for word, named in profile.exemption_types.items():
            if _hits([decision], [word]):
                worded = named
                break
    add("type_matches_decision", None if not (kind and worded) else kind == worded,
        True, "type_disagrees_with_decision")

    legal = fields.get("decisionReason", {}).get("type")
    add("reason_matches_type", None if not (kind and legal) else kind == legal, True, "reason_disagrees_with_type")

    # Seen on every sample so far, not found published: shown for a person, never a verdict.
    military = fields.get("militaryNumber", {}).get("value") or ""
    from_nid = _birth_from_national_id(number["value"]) if nid_ok else None
    year = born.year if born else (from_nid.year if from_nid else None)
    add("military_year_matches_birth", None if not (year and len(military) >= 8) else military[:4] == str(year),
        False, "military_year_disagrees_with_birth")

    # The recruitment area is where he lives; the national ID's governorate where his birth was
    # registered. People move, so a difference is for a person to look at, nothing more.
    area = _CODE_OF.get(fields.get("recruitmentArea", {}).get("value", ""))
    add("area_matches_national_id", None if not (area and nid_ok) else number["value"][7:9] == area,
        False, "area_disagrees_with_national_id")
    return out


def read_exemption_lines(
    rows: list[str],
    profile: ExemptionProfile | None = None,
    holder: dict[str, str] | None = None,
    today: date | None = None,
    face_fills_frame: bool = False,
) -> ExemptionRead:
    """Decide from the certificate's text rows (top to bottom), labels and values on one row.
    `holder` is the National ID Card's `{nationalId, fullNameAr}` when the person scanned that too,
    for the consistency check. A photo goes through `read_exemption_page`, which also has places."""
    profile = profile or load_profile()
    evidence, early = _screen(rows, profile, face_fills_frame)
    fields: dict[str, dict[str, Any]] = {}
    if early is not None:
        return ExemptionRead(fields, evidence, early)
    for name, labels in profile.fields.items():
        value = _label_value(rows, labels)
        if value:
            fields[name] = {"value": value, "confidence": "medium"}
    return ExemptionRead(fields, evidence, _judge(fields, evidence, rows, profile, holder, today))


# ── The certificate as a page: lines with their places ─────────────────────────────────────────

def _centre(line: dict[str, Any]) -> float:
    return (line["box"][1] + line["box"][3]) / 2


def _height(line: dict[str, Any]) -> float:
    return max(1.0, line["box"][3] - line["box"][1])


def _page_rows(lines: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Lines grouped into rows (by their middles), each right to left; rows top to bottom."""
    rows: list[list[dict[str, Any]]] = []
    for line in sorted(lines, key=_centre):
        if rows and abs(_centre(line) - _centre(rows[-1][0])) <= 0.6 * max(_height(line), _height(rows[-1][0])):
            rows[-1].append(line)
        else:
            rows.append([line])
    return [sorted(row, key=lambda item: -item["box"][2]) for row in rows]


def _label_score(text: str, label: str) -> float:
    """The share of a label's words found in a line (each word once, a letter of OCR slack)."""
    words = _fold_tokens(label)
    tokens = _fold_tokens(text)
    return sum(1 for word in words if any(_same_word(token, word) for token in tokens)) / max(1, len(words))


def _x_overlap(a: dict[str, Any], b: dict[str, Any]) -> float:
    """How much two lines share horizontally, as a share of the narrower one."""
    shared = min(a["box"][2], b["box"][2]) - max(a["box"][0], b["box"][0])
    narrower = min(a["box"][2] - a["box"][0], b["box"][2] - b["box"][0])
    return max(0.0, shared) / max(1.0, narrower)


def _without_label(text: str, label: str) -> str:
    words = _fold_tokens(label)
    kept = [token for token, folded in zip(text.split(), _fold_tokens(text))
            if not any(_same_word(folded, word) for word in words)]
    return " ".join(kept).strip(" :-")


def _value_of(kind: str, text: str, spec: dict[str, Any]) -> str | None:
    """What a field of this kind looks like inside a line's text, normalised; None if absent."""
    western = to_western_digits(text)
    if kind == "date":
        when = _parse_date(western)
        return when.isoformat() if when else None
    if kind == "nationalId":
        runs = re.findall(r"\d{14}", re.sub(r"\s+", "", western))
        return runs[0] if runs else None
    if kind == "digits":
        without_dates = _DATE.sub(" ", western)  # a date joined into the same box is not this number
        digits = "".join(_DIGITS.findall(without_dates))
        return digits if len(digits) >= int(spec.get("minDigits", 1)) else None
    if kind == "name":
        words = [token.strip(":.-،") for token in text.split()]
        words = [word for word in words if word and not re.search(r"[\dA-Za-z]", to_western_digits(word))]
        return " ".join(words) if len(words) >= 2 else None
    cleaned = text.strip(" :-")
    return cleaned or None


def _cell(label_line: dict[str, Any], lines: list[dict[str, Any]]) -> tuple[float, float]:
    """The left and right edges of a header label's table cell: halfway to the next text on its
    row either side (a cell is wider than its label: "كود" heads a cell three times its width)."""
    left, right = label_line["box"][0], label_line["box"][2]
    width = right - left
    row = [
        line for line in lines
        if line is not label_line
        and abs(_centre(line) - _centre(label_line)) <= 0.6 * max(_height(line), _height(label_line))
    ]
    before = [line["box"][2] for line in row if line["box"][2] <= left + 0.1 * width]
    after = [line["box"][0] for line in row if line["box"][0] >= right - 0.1 * width]
    return (
        (left + max(before)) / 2 if before else left - width,
        (right + min(after)) / 2 if after else right + width,
    )


def _header_bottom(label_line: dict[str, Any], lines: list[dict[str, Any]], cell: tuple[float, float]) -> float:
    """Where a header cell's printed words end: a label can run onto a second line ("(الثلاثي)")."""
    bottom = label_line["box"][3]
    for line in lines:
        centre_x = (line["box"][0] + line["box"][2]) / 2
        if (cell[0] <= centre_x <= cell[1] and not _DIGITS.search(to_western_digits(line["text"]))
                and _centre(label_line) < _centre(line) <= _centre(label_line) + 1.6 * _height(label_line)):
            bottom = max(bottom, line["box"][3])
    return bottom


def _find_labels(lines: list[dict[str, Any]], profile: ExemptionProfile) -> dict[str, tuple[dict[str, Any], str]]:
    """field → (its label's line, the label as printed). A label row ("header") holds several
    labels: there, a label whose value is printed below it wins a tie."""
    rows = _page_rows(lines)
    header_of: dict[int, bool] = {}
    for row in rows:
        labelled = sum(
            1 for line in row
            if any(_label_score(line["text"], label) >= 0.5 for labels in profile.fields.values() for label in labels)
        )
        for line in row:
            header_of[id(line)] = labelled >= 3

    candidates: list[tuple[float, int, str, dict[str, Any], str]] = []
    for line in lines:
        for name, labels in profile.fields.items():
            spec = profile.spec(name)
            if spec["layout"] == "paragraph":
                continue  # found by its words, not a label
            for label in labels:
                score = _label_score(line["text"], label)
                if score < 0.5 or len(line["text"].split()) > len(label.split()) + 5:
                    continue
                fits = (spec["layout"] == "below") == header_of[id(line)]
                candidates.append((score, int(fits), name, line, label))
    # The best evidence first: the most of a label read, then a label in the place its kind lives.
    candidates.sort(key=lambda item: (item[0], item[1], len(item[4].split())), reverse=True)
    chosen: dict[str, tuple[dict[str, Any], str]] = {}
    used: set[int] = set()
    for score, fits, name, line, label in candidates:
        if name in chosen or id(line) in used:
            continue
        chosen[name] = (line, label)
        used.add(id(line))
    return chosen


def read_exemption_page(
    lines: list[dict[str, Any]],
    profile: ExemptionProfile | None = None,
    holder: dict[str, str] | None = None,
    today: date | None = None,
    face_fills_frame: bool = False,
    reread: Any = None,
) -> ExemptionRead:
    """Decide from the certificate's lines with their places (`{text, score, box}`).

    The certificate is a form with a table: some labels have their value beside them ("inline":
    the name, the birth date, the date it was written), some head a column with the value in the
    row below ("below": the military card, the national ID, the decision's code, number and date),
    and the decision itself is a sentence ("paragraph"). Values are never `high`: a person checks.

    `reread(box, kind)` reads a number's box again, closer (the service passes one): its answer is
    taken when it is longer, or when it agrees with the printed birth date and the first did not.
    """
    profile = profile or load_profile()
    rows = ["   ".join(line["text"] for line in row) for row in _page_rows(lines)]
    evidence, early = _screen(rows, profile, face_fills_frame)
    fields: dict[str, dict[str, Any]] = {}
    if early is not None:
        return ExemptionRead(fields, evidence, early)

    labels = _find_labels(lines, profile)
    label_lines = {id(line) for line, _ in labels.values()}

    boxes: dict[str, list[float]] = {}
    #: below field → (its cell's left and right, the bottom of its value row, the header's height).
    cells: dict[str, tuple[float, float, float, float]] = {}
    #: Numbers printed in groups whose closer read must put the groups back in Arabic order.
    grouped: set[str] = set()
    #: Inline values' boxes (a birth date that disagrees with the national ID is read again).
    inline_boxes: dict[str, list[float]] = {}

    def take(name: str, value: str, score: float, box: list[float] | None = None, source: str = "") -> None:
        fields[name] = {"value": value, "confidence": "medium" if score >= 0.6 else "low"}
        if profile.spec(name)["kind"] == "date" and _date_is_guessed(source):
            fields[name]["confidence"] = "low"  # a slash was guessed: a person reads the date
        if box is not None:
            boxes[name] = box

    for name, (label_line, label) in labels.items():
        spec = profile.spec(name)
        kind = spec["kind"]
        if spec["layout"] == "below":
            cell = _cell(label_line, lines)
            top = _header_bottom(label_line, lines, cell)

            def in_cell(line: dict[str, Any], cell: tuple[float, float] = cell) -> bool:
                return cell[0] <= (line["box"][0] + line["box"][2]) / 2 <= cell[1]

            under = [
                line for line in lines
                if id(line) not in label_lines
                and _centre(line) > _centre(label_line)
                and line["box"][1] < label_line["box"][3] + 3 * _height(label_line)
                and (_x_overlap(line, label_line) >= 0.3 or in_cell(line))
            ]
            cells[name] = (cell[0], cell[1], top + 1.6 * _height(label_line), _height(label_line))
            for line in sorted(under, key=_centre):
                row = [line]
                if kind == "digits" and _DIGITS.search(to_western_digits(line["text"])):
                    # A number printed in groups the detector boxed apart (the military card's three):
                    # every group on the row, inside the cell, joined right to left as Arabic reads.
                    row += [other for other in under if other is not line and in_cell(other)
                            and abs(_centre(other) - _centre(line)) <= 0.6 * max(_height(other), _height(line))
                            and _DIGITS.search(to_western_digits(other["text"]))]
                    row.sort(key=lambda item: -item["box"][2])
                value = _value_of(kind, " ".join(item["text"] for item in row), spec)
                if not value:
                    continue
                box = [min(item["box"][0] for item in row), min(item["box"][1] for item in row),
                       max(item["box"][2] for item in row), max(item["box"][3] for item in row)]
                take(name, value, min(item["score"] for item in row), box, " ".join(item["text"] for item in row))
                if kind == "digits" and spec.get("groups"):
                    # Printed in groups: read again across the whole cell, inside its borders, group
                    # by group (a faint group is often lost to the page detector).
                    inset = 0.06 * (cell[1] - cell[0])
                    boxes[name] = [cell[0] + inset, box[1], cell[1] - inset, box[3]]
                    grouped.add(name)
                cells[name] = (cell[0], cell[1], box[3], _height(label_line))
                break
            continue
        # Inline: the rest of the label's own line, else the nearest line beside it (to its left,
        # as Arabic runs right to left) on the same row.
        value = _value_of(kind, _without_label(label_line["text"], label), spec)
        if value:
            take(name, value, label_line["score"], source=label_line["text"])
            continue
        beside = [
            line for line in lines
            if id(line) not in label_lines
            and line["box"][2] <= label_line["box"][0] + 0.25 * (label_line["box"][2] - label_line["box"][0])
            and abs(_centre(line) - _centre(label_line)) <= 1.2 * max(_height(line), _height(label_line))
        ]
        for line in sorted(beside, key=lambda item: label_line["box"][0] - item["box"][2]):
            value = _value_of(kind, line["text"], spec)
            if value:
                take(name, value, line["score"], source=line["text"])
                inline_boxes[name] = line["box"]
                break

    # A label the detector lost: its value is still on the row of a neighbour's label (the name sits
    # on the birth date's row, to its right).
    for name in profile.fields:
        spec = profile.spec(name)
        anchor = labels.get(spec.get("sameRowAs", ""))
        if name in fields or anchor is None:
            continue
        anchor_line = anchor[0]
        right = spec.get("side", "right") == "right"
        beside = [
            line for line in lines
            if id(line) not in label_lines
            and abs(_centre(line) - _centre(anchor_line)) <= 1.2 * max(_height(line), _height(anchor_line))
            and (line["box"][0] >= anchor_line["box"][2] - 5 if right else line["box"][2] <= anchor_line["box"][0] + 5)
        ]
        for line in sorted(beside, key=lambda item: abs(item["box"][0] - anchor_line["box"][2])):
            value = _value_of(spec["kind"], line["text"], spec)
            if value and not _hits([value], profile.title_words):
                take(name, value, line["score"])
                break

    # A number the detector lost (or read too short to be one): read its cell again, closer.
    if reread is not None:
        for name, (cell_left, cell_right, row_bottom, header_height) in list(cells.items()):
            spec = profile.spec(name)
            current = fields.get(name, {}).get("value")
            if spec["kind"] == "nationalId":
                weak = current is None or not is_structurally_valid(current)
            elif spec["kind"] == "digits":
                weak = current is None or len(current) < int(spec.get("minDigits", 1))
            else:
                continue
            if not weak:
                continue
            inset = 0.08 * (cell_right - cell_left)
            top = row_bottom - 1.6 * header_height
            box = [cell_left + inset, top, cell_right - inset, row_bottom]
            again = reread(box, "nationalId" if spec["kind"] == "nationalId"
                           else "groups" if spec.get("groups") else "digits")
            agreed = None
            if isinstance(again, list):
                total = sum(int(n) for n in spec.get("groupLengths") or []) or None
                reads = [read for read in again if read and (total is None or len(read) == total)]
                again, agreed = (reads[0], reads.count(reads[0]) >= 2) if reads else (None, False)
            if isinstance(again, tuple):
                again, agreed = again
            if again and (is_structurally_valid(again) if spec["kind"] == "nationalId"
                          else len(again) >= int(spec.get("minDigits", 1))):
                take(name, again, 0.6 if agreed is not False else 0.0, box)

    # Where each number was issued: the words printed under it, in its cell.
    for name, number in profile.issuers.items():
        if number not in cells:
            continue
        cell_left, cell_right, row_bottom, header_height = cells[number]
        below = [
            line for line in lines
            if id(line) not in label_lines
            and cell_left <= (line["box"][0] + line["box"][2]) / 2 <= cell_right
            and row_bottom - 0.3 * header_height < _centre(line) <= row_bottom + 2.5 * header_height
            and not _DIGITS.search(to_western_digits(line["text"]))
            and re.search(r"[\u0621-\u064a]{2,}", line["text"])
        ]
        if below:
            line = min(below, key=_centre)
            take(name, clean_place(line["text"]), line["score"])

    # A name read short (the detector lost words of it): read its place on the row again, between
    # its label and the birth date's.
    name_spec = profile.spec("fullNameAr")
    current = fields.get("fullNameAr", {}).get("value")
    if reread is not None and (current is None or len(str(current).split()) < 3):
        own = labels.get("fullNameAr")
        anchor = labels.get(name_spec.get("sameRowAs", ""))
        if own is not None or anchor is not None:
            row_line = (own or anchor)[0]
            if own is not None:
                right = own[0]["box"][0] - 5
            else:
                # Its label was not read as one: it is still the rightmost text on the row.
                on_row = sorted((line for line in lines if line["box"][0] > row_line["box"][2]
                                 and abs(_centre(line) - _centre(row_line)) <= _height(row_line)),
                                key=lambda line: -line["box"][2])
                right = (on_row[0]["box"][0] - 5 if len(on_row) >= 2
                         else on_row[0]["box"][2] if on_row else row_line["box"][2])
            left = anchor[0]["box"][2] + 5 if anchor is not None else right - 8 * _height(row_line)
            middle, half = _centre(row_line), 0.8 * _height(row_line)
            if right > left:
                again = reread([left, middle - half, right, middle + half], "text")
                value = _value_of("name", again or "", name_spec)
                if value and len(value.split()) > len(str(current or "").split()):
                    take("fullNameAr", value, 0.6 if len(value.split()) >= 3 else 0.0)

    # The recruitment area, printed in the header after "منطقة تجنيد": a governorate's name.
    if profile.recruitment_area_labels:
        for line in lines:
            if max(_label_score(line["text"], label) for label in profile.recruitment_area_labels) < 0.5 or not _hits(
                    [line["text"]], [label.split()[0] for label in profile.recruitment_area_labels]):
                continue
            same_row = [line] + sorted(
                (other for other in lines if other is not line and other["box"][2] <= line["box"][2]
                 and abs(_centre(other) - _centre(line)) <= 0.8 * max(_height(other), _height(line))),
                key=lambda other: -other["box"][2])
            words = [word.strip(".:-…") for other in same_row for word in other["text"].split()]
            found = next((match_governorate(word) for word in words if word and match_governorate(word)), None)
            if found:
                take("recruitmentArea", found, line["score"])
                break

    # The article's part, named in the title: "طبقاً للمادة السابعة البند أولاً فقرة (ب)".
    if profile.clauses:
        top_rows = rows[: max(1, len(rows) // 2)]
        for index, row in enumerate(top_rows):
            folded = _fold_tokens(row)
            part = next((spec for word, spec in profile.clauses.items()
                         for token in folded if _same_word(token, rasm_fold(word))), None)
            if part is None:
                continue
            nearby = " ".join(top_rows[index : index + 2])
            letter = re.search(r"\(\s*([\u0621-\u064a]{1,2})\s*\)", nearby)
            value = part["value"] + (f" ({letter.group(1)})" if letter else "")
            fields["legalClause"] = {"value": value, "confidence": "medium", "type": part.get("type")}
            break

    # Sentences found by their words: the decision.
    for name in profile.fields:
        spec = profile.spec(name)
        if spec["layout"] != "paragraph":
            continue
        keywords = spec.get("keywords") or profile.fields[name]
        found = [line for line in lines if id(line) not in label_lines and _hits([line["text"]], keywords) >= 2]
        if found:
            # The sentence runs on below: the next lines in the same block, until a gap.
            left = min(line["box"][0] for line in found)
            right = max(line["box"][2] for line in found)
            block = {id(line) for line in found}
            last = min(found, key=_centre)
            for line in sorted(lines, key=_centre):
                if _centre(line) <= _centre(last) or id(line) in label_lines:
                    continue
                shared = min(right, line["box"][2]) - max(left, line["box"][0])
                if shared < 0.5 * (line["box"][2] - line["box"][0]):
                    continue
                if line["box"][1] > last["box"][3] + 1.0 * _height(last):
                    break
                if id(line) not in block:
                    found.append(line)
                    block.add(id(line))
                last = line
            text = " ".join(_without_label(line["text"], label) for line in sorted(found, key=_centre)
                            for label in profile.fields[name][:1])
            if profile.decision_words:
                text = correct_form_text(text, profile)
            take(name, text, min(line["score"] for line in found))
            if profile.reasons:
                reason_id, legal_type, arabic, english = classify_reason(text, profile)
                evidence["decisionReason"] = {"id": reason_id, "type": legal_type, "ar": arabic, "en": english}
                fields["decisionReason"] = {
                    "value": arabic, "valueEn": english, "reasonId": reason_id, "type": legal_type,
                    "confidence": "medium" if reason_id != "other" and fields[name]["confidence"] == "medium" else "low",
                }

    # No national ID number under its label: any 14 digits on the page that make a possible one.
    if "nationalId" in profile.fields and "nationalId" not in fields:
        for line in lines:
            value = _value_of("nationalId", line["text"], {})
            if value and is_structurally_valid(value):
                take("nationalId", value, line["score"])
                break

    # Numbers read again, closer, when the service can (see `reread` above).
    if reread is not None:
        born = _parse_date(fields["birthDate"]["value"]) if "birthDate" in fields else None
        for name, box in boxes.items():
            kind = profile.spec(name)["kind"]
            if kind not in ("nationalId", "digits"):
                continue
            current = fields[name]["value"]
            if kind == "nationalId":
                agrees = is_structurally_valid(current) and (born is None or _birth_from_national_id(current) == born)
                again = reread(box, "nationalId")
                if not agrees:
                    if again and is_structurally_valid(again) and (born is None or _birth_from_national_id(again) == born):
                        fields[name]["value"] = again
                elif again and is_structurally_valid(again) and again != current:
                    # Two possible numbers, differing outside the birth date (which both match): no
                    # read is chosen silently; a person checks it against the certificate.
                    fields[name]["confidence"] = "low"
                    fields[name]["readsDisagree"] = True
            else:
                again = reread(box, "groups" if name in grouped else "digits")
                agreed = None
                lengths = profile.spec(name).get("groupLengths")
                if isinstance(again, list) and lengths:
                    # Every closer read, best first: the page's own read counts as one more.
                    total = sum(int(n) for n in lengths)
                    reads = [read for read in again if read and read.isdigit() and len(read) == total]
                    if len(current) == total and current in reads:
                        continue  # two reads agree on the page's number
                    if not reads:
                        if len(current) != total:
                            fields[name]["confidence"] = "low"
                        continue
                    best = reads[0]
                    if len(current) == total:
                        fields[name]["confidence"] = "low"
                        fields[name]["readsDisagree"] = True
                        continue
                    fields[name]["value"] = best
                    fields[name]["confidence"] = "medium" if reads.count(best) >= 2 else "low"
                    continue
                if isinstance(again, tuple):  # (value, whether two or more closer reads agreed)
                    again, agreed = again
                if name in grouped and lengths:
                    total = sum(int(n) for n in lengths)
                    if again and again.isdigit() and len(again) == total:
                        if again == current:
                            continue  # the page's read and the closer read agree
                        if len(current) != total or current in again:
                            fields[name]["value"] = again
                            if agreed is not None:
                                fields[name]["confidence"] = "medium" if agreed else "low"
                            continue
                    elif len(current) != total:
                        fields[name]["confidence"] = "low"  # no read of the printed length
                        continue
                    elif not again or again == current:
                        continue
                    fields[name]["confidence"] = "low"
                    fields[name]["readsDisagree"] = True
                    continue
                if not again or not again.isdigit() or again == current:
                    continue
                if len(again) > len(current) and current in again:
                    fields[name]["value"] = again  # the first read lost digits at an edge
                else:
                    # A closer read of spaced groups can come back longer and wrong, so neither read
                    # is chosen silently: a person checks the number against the certificate.
                    fields[name]["confidence"] = "low"
                    fields[name]["readsDisagree"] = True

    # A printed birth date that disagrees with a possible national ID: read the date again, closer.
    # Taken only when the second read agrees with the number (as for the number itself, above).
    if reread is not None and "birthDate" in inline_boxes and "nationalId" in fields:
        number = fields["nationalId"]["value"]
        expected = _birth_from_national_id(number) if is_structurally_valid(number) else None
        if expected and _parse_date(fields["birthDate"]["value"]) != expected:
            again = _parse_date(reread(inline_boxes["birthDate"], "date") or "")
            if again == expected:
                fields["birthDate"]["value"] = again.isoformat()

    # A name a person must check: a word one letter off a known name (the shape of a misread, as on
    # the National ID Card), or a count of words the certificate's four-part name never has.
    from .lexicon import near_miss  # noqa: PLC0415

    from .lexicon import correct as correct_name  # noqa: PLC0415

    for name, data in fields.items():
        if profile.spec(name)["kind"] != "name":
            continue
        # A dot or a tooth misread (ح/خ, ب/ي) is put back when exactly one listed name fits, as on
        # the National ID Card: محمود read as مخمود, عبدالله as عيدالله.
        data["value"], corrected = correct_name(str(data["value"]), "name")
        if corrected:
            data["corrected"] = True
        words = str(data["value"]).split()
        # The certificate prints the full four-part name: fewer parts means one was lost.
        if not 4 <= len(words) <= 5 or near_miss(str(data["value"]), "name"):
            data["confidence"] = "low"

    # A name with a one-letter word is noise read as a name (Arabic names have none): flag it.
    for name, data in fields.items():
        if profile.spec(name)["kind"] == "name" and any(len(word) == 1 for word in str(data["value"]).split()):
            data["confidence"] = "low"

    # The kind of exemption, from the title's own row (final, temporary): elsewhere a word one letter
    # off a type word is too easy to meet ("(الثلاثى)" under a label, folded, is one off "النهائي").
    title_rows = [row for row in rows if _hits([row], ["شهادة"]) and _hits([row], ["بالإعفاء", "الإعفاء"])]
    for word, kind in profile.exemption_types.items():
        if _hits(title_rows, [word]) or (not title_rows and any(
                rasm_fold(word) in _fold_tokens(row) for row in rows[: max(1, len(rows) // 2)])):
            fields["exemptionType"] = {"value": kind, "confidence": "medium"}
            break

    return ExemptionRead(fields, evidence, _judge(fields, evidence, rows, profile, holder, today))


def extract_exemption(front: str | None, back: str | None, recognizer: Any, holder: dict | None = None):
    """The service's reader: the certificate's photo → an ExtractionResult carrying its verdict."""
    import cv2  # noqa: PLC0415 - the pipeline has it loaded already

    from .extract import ExtractionResult  # noqa: PLC0415 - extract imports this module's neighbours

    result = ExtractionResult()
    started = time.perf_counter()
    path = front or back
    photo = load_bgr(path)
    longest = max(photo.shape[:2])
    if longest < MIN_READ_SIDE:
        scale = READ_SIDE / longest
        photo = cv2.resize(photo, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    # Which way up from a quick read; then the page read at its own resolution (the quick read is
    # scaled down to the detector's canvas, too small for a certificate's print).
    upright_photo, turned, _ = upright_certificate(photo, recognizer)
    page_read = getattr(recognizer, "read_page", None) or recognizer.detect_lines
    read = read_document(upright_photo, recognizer, read_lines=list(page_read(upright_photo)), turned=turned)
    rows = [row for row in read["text"].split("\n") if row.strip()]
    face = len(rows) <= 2 and _face_fills_frame(photo)
    upright_image = read["uprightImage"]

    def _read_grouped(box: list[float], whole_row: str | None) -> list[str]:
        """A grouped number read several ways, best first: group by group under each way of
        splitting the row (kept only when every group reads at its printed length, ranked by how
        many of its reads back each group), then the whole row read at once."""
        from collections import Counter  # noqa: PLC0415

        from .preprocess import field_variant  # noqa: PLC0415

        lengths = [int(n) for n in (load_profile().spec("militaryNumber").get("groupLengths") or [])]
        if not lengths:
            return [whole_row] if whole_row else []
        height, width = upright_image.shape[:2]
        left, top, right, bottom = box
        pad = 0.25 * (bottom - top)
        region = upright_image[int(max(0, top - pad)):int(min(height, bottom + pad)),
                               int(max(0, left)):int(min(width, right))]
        if not region.size:
            return [whole_row] if whole_row else []
        visual = list(reversed(lengths))  # on the page, the last group is leftmost
        votes_of: dict[tuple[int, int], Counter] = {}

        def votes(a: int, b: int) -> Counter:
            if (a, b) not in votes_of:
                margin = int(0.3 * (bottom - top))
                crop = region[:, max(0, a - margin):min(region.shape[1], b + margin)]
                counted: Counter = Counter()
                for variant in ("binary", "grey", "clahe", "thick"):
                    for scale in (1.0, 2.0):
                        sized = crop if scale == 1.0 else cv2.resize(crop, None, fx=scale, fy=scale,
                                                                     interpolation=cv2.INTER_CUBIC)
                        try:
                            out = recognizer.recognize(field_variant(sized, variant), rtl=False)
                        except Exception:  # noqa: BLE001 - one failed read is one vote fewer
                            continue
                        digits = "".join(_DIGITS.findall(to_western_digits(out.text or "")))
                        if digits:
                            counted[digits] += 1
                votes_of[(a, b)] = counted
            return votes_of[(a, b)]

        ranked: list[tuple[float, str]] = []
        for split in split_groups(region, len(lengths), text_height=bottom - top):
            if len(split) != len(lengths):
                continue
            groups, support = [], 1.0
            for index, (a, b) in enumerate(split):
                counted = votes(a, b)
                fitting = Counter({k: n for k, n in counted.items() if len(k) == visual[index]})
                if not fitting:
                    break
                read, n = fitting.most_common(1)[0]
                groups.append(read)
                support *= n / max(1, sum(counted.values()))
            else:
                ranked.append((support, "".join(reversed(groups))))
        ranked.sort(key=lambda item: -item[0])
        return [read for _, read in ranked] + ([whole_row] if whole_row else [])

    def reread(box: list[float], kind: str) -> str | tuple[str | None, bool] | None:
        """A number's box read again under every filter (the National ID Card's own digit reader)."""
        from .extract import _read_digits  # noqa: PLC0415
        from .layout import FieldBox  # noqa: PLC0415

        height, width = upright_image.shape[:2]
        left, top, right, bottom = box
        pad = 0.25 * (bottom - top)
        strip = FieldBox(name=kind, x=max(0.0, left - pad) / width, y=max(0.0, top - pad) / height,
                         w=min(width, right + pad - max(0.0, left - pad)) / width,
                         h=min(height, bottom + pad - max(0.0, top - pad)) / height, kind="digits")
        if kind == "text":  # a name's place on its row, read as words
            from .extract import _read_text  # noqa: PLC0415

            top, bottom = int(max(0.0, box[1])), int(min(height, box[3]))
            region = upright_image[top:bottom, int(max(0.0, left)):int(min(width, right))]
            if region.size == 0:
                return None
            try:
                return _read_text(recognizer, region)[0] or None
            except Exception:  # noqa: BLE001 - a second read is a second chance, never a failure
                return None
        try:
            text = _read_digits(upright_image, strip, recognizer, ensemble=True).text
        except Exception:  # noqa: BLE001 - a second read is a second chance, never a failure
            return None
        digits = "".join(_DIGITS.findall(to_western_digits(text or "")))
        if kind == "nationalId":
            runs = re.findall(r"\d{14}", digits)
            return runs[0] if runs else None
        if kind == "groups":
            try:
                return _read_grouped(box, rtl_groups(text) or None)
            except Exception:  # noqa: BLE001 - a second read is a second chance, never a failure
                return [rtl_groups(text)] if rtl_groups(text) else None
        if kind == "date":
            return to_western_digits(text or "") or None
        return digits or None

    outcome = read_exemption_page(read["lines"], holder=holder, face_fills_frame=face, reread=reread)
    result.fields.update(outcome.fields)
    result.oriented["front"] = read["uprightImage"]
    result.diagnostics["front"] = {"linesDetected": len(read["lines"]), "rotated": read["rotated"],
                                   "enlarged": longest < MIN_READ_SIDE}
    result.diagnostics["exemptionCheck"] = {**outcome.evidence, **outcome.verdict.as_dict()}
    result.total_ms = (time.perf_counter() - started) * 1000.0
    return result


def exemption_verdict(result: Any) -> Verdict:
    check = result.diagnostics.get("exemptionCheck") or {}
    return Verdict(DOCUMENT_TYPE, check.get("status", "unreadable"), tuple(check.get("reasons", ("no_text",))))
