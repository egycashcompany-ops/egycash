"""Move the field boxes onto the text that is actually there."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import numpy as np

from .arabic import rasm_fold, to_western_digits
from .boilerplate import is_boilerplate
from .layout import FieldBox
from .postprocess import MARITAL_TERMS as _MARITAL_TERMS
from .postprocess import RELIGION_TERMS as _RELIGION_TERMS

#: A detected line as the recognizers report it: (polygon, text, score).
Line = tuple[Any, str, float]

#: A normalized (x, y, w, h).
Rect = tuple[float, float, float, float]


@dataclass(frozen=True)
class Anchoring:
    """Where each field will actually be cropped from, and on what evidence."""

    boxes: dict[str, FieldBox]
    #: field → 'nominal' | 'snapped' | 'structural'. Reported so a card that needed heavy
    #: correction is visible as such rather than looking like a clean read.
    sources: dict[str, str]

    def source_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for source in self.sources.values():
            counts[source] = counts.get(source, 0) + 1
        return counts


def _rect(poly: Any, size: tuple[int, int]) -> tuple[float, float, float, float] | None:
    """A detection polygon as a normalized (x, y, w, h), or None if it cannot be read."""
    try:
        points = np.asarray(poly, dtype=float).reshape(-1, 2)
    except (TypeError, ValueError):
        return None
    if points.size == 0:
        return None
    width, height = size
    xs, ys = points[:, 0] / width, points[:, 1] / height
    left, right = float(xs.min()), float(xs.max())
    top, bottom = float(ys.min()), float(ys.max())
    if right <= left or bottom <= top:
        return None
    return left, top, right - left, bottom - top


@dataclass(frozen=True)
class _Region:
    """One line of text as this module wants it: a rectangle and what is written in it."""

    rect: Rect
    text: str


#: Two fragments closer than this many line-heights apart, horizontally, are words of one line.
MERGE_GAP_LINES = 1.2

#: How far, as a fraction of the box's width, a line's centre may sit outside the box sideways and
#: still belong to it. See `_overlaps`.
MAX_SLACK_X = 0.10


def _merge_rows(regions: list[_Region], size: tuple[int, int]) -> list[_Region]:
    """Join detection fragments that are words of the same printed line."""
    if len(regions) < 2:
        return regions

    line_height = _median_line_height([region.rect for region in regions])
    # Heights are fractions of the card's height and gaps are fractions of its width, so the
    # threshold has to cross between the two axes or it means something different on every card.
    gap_limit = line_height * MERGE_GAP_LINES * size[1] / max(size[0], 1)

    rows: list[list[_Region]] = []
    for region in sorted(regions, key=lambda item: item.rect[1]):
        centre = region.rect[1] + region.rect[3] / 2.0
        for row in rows:
            row_centre = float(np.mean([r.rect[1] + r.rect[3] / 2.0 for r in row]))
            if abs(centre - row_centre) <= line_height / 2.0:
                row.append(region)
                break
        else:
            rows.append([region])

    merged: list[_Region] = []
    for row in rows:
        row.sort(key=lambda item: item.rect[0])
        group = [row[0]]
        for region in row[1:]:
            previous = group[-1]
            gap = region.rect[0] - (previous.rect[0] + previous.rect[2])
            if gap <= gap_limit:
                group.append(region)
            else:
                merged.append(_join(group))
                group = [region]
        merged.append(_join(group))
    return merged


def _join(group: list[_Region]) -> _Region:
    """One region from several. Text runs right to left, as the card is printed."""
    if len(group) == 1:
        return group[0]
    return _Region(_union([region.rect for region in group]), " ".join(
        region.text for region in sorted(group, key=lambda item: item.rect[0], reverse=True)
    ))


def _prepare(lines: list[Line], size: tuple[int, int]) -> list[_Region]:
    """Detected lines → the regions anchoring reasons about."""
    regions = [
        _Region(rect, text)
        for rect, text in ((_rect(poly, size), text) for poly, text, _ in lines)
        if rect is not None
    ]
    regions = [region for region in regions if not is_boilerplate(region.text)]
    return _merge_rows(regions, size)


def _overlaps(
    rect: tuple[float, float, float, float], box: FieldBox, margin: float, line_height: float
) -> bool:
    """Is this line's centre inside the box, allowing for a little drift?"""
    x, y, w, h = rect
    centre_x, centre_y = x + w / 2.0, y + h / 2.0
    slack_y = min(box.h * margin, line_height * 0.5)
    # Horizontal slack is capped too, for the same kind of reason.
    slack_x = box.w * min(margin, MAX_SLACK_X)
    return (
        box.x - slack_x <= centre_x <= box.x + box.w + slack_x
        and box.y - slack_y <= centre_y <= box.y + box.h + slack_y
    )


def _clamp_to(
    rect: tuple[float, float, float, float], box: FieldBox, line_height: float
) -> tuple[float, float, float, float]:
    """Fit the crop to the detected lines vertically, and never narrow it horizontally."""
    x, y, w, h = rect
    top = max(y, box.y - line_height)
    bottom = min(y + h, box.y + box.h + line_height)
    if bottom <= top:
        top, bottom = y, y + h
    left = min(x, box.x)
    right = max(x + w, box.x + box.w)
    return left, top, right - left, bottom - top


def _union(rects: list[tuple[float, float, float, float]]) -> tuple[float, float, float, float]:
    left = min(r[0] for r in rects)
    top = min(r[1] for r in rects)
    right = max(r[0] + r[2] for r in rects)
    bottom = max(r[1] + r[3] for r in rects)
    return left, top, right - left, bottom - top


def _pad(
    rect: tuple[float, float, float, float], amount: float = 0.04
) -> tuple[float, float, float, float]:
    """Grow a rect slightly. Detection polygons hug the ink, and a crop taken exactly on that boundary
    shaves the ascenders and the dots off the top line, which is the same information loss the
    whole pipeline is trying to avoid.
    """
    x, y, w, h = rect
    grow_x, grow_y = w * amount, h * amount
    return (
        max(0.0, x - grow_x),
        max(0.0, y - grow_y),
        min(1.0 - max(0.0, x - grow_x), w + 2 * grow_x),
        min(1.0 - max(0.0, y - grow_y), h + 2 * grow_y),
    )


#: A crop that grew past this multiple of its nominal area has almost certainly swallowed the
#: neighbouring field.
MAX_GROWTH = 2.5

_FULL_DATE = re.compile(r"\d{4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2}")

#: Structurally-found fields keep their nominal recognition kind; the two digit ones are digits.
_KIND = {"nationalId": "digits", "nationalIdExpiry": "digits"}


def _mentions(text: str, terms: tuple[str, ...]) -> bool:
    """Does this line carry one of a closed vocabulary's terms, allowing for dropped dots?"""
    folded = rasm_fold(text)
    return any(rasm_fold(term) in folded for term in terms)


def _carries_a_national_id(folded: str) -> bool:
    """Does this line hold the fourteen-digit number, in either of the two forms it appears in?"""
    runs = re.findall(r"\d+", folded)
    return sum(len(run) for run in runs) == 14 or any(len(run) == 14 for run in runs)

#: Fallback when detection found nothing to measure, roughly one printed line on an ID-1 card.
DEFAULT_LINE_HEIGHT = 0.07


def _median_line_height(rects: list[tuple[float, float, float, float]]) -> float:
    """How tall a line of print is on this card, as a fraction of its height."""
    heights = [h for _, _, _, h in rects if h > 0]
    return float(np.median(heights)) if heights else DEFAULT_LINE_HEIGHT


def snap(
    boxes: tuple[FieldBox, ...], lines: list[Line], size: tuple[int, int], *, margin: float = 0.35
) -> tuple[dict[str, FieldBox], dict[str, str]]:
    """Fit each nominal box to the detected lines around it."""
    rects = [region.rect for region in _prepare(lines, size)]
    line_height = _median_line_height(rects)

    fitted: dict[str, FieldBox] = {}
    sources: dict[str, str] = {}
    for box in boxes:
        near = [rect for rect in rects if _overlaps(rect, box, margin, line_height)]
        if not near:
            fitted[box.name], sources[box.name] = box, "nominal"
            continue
        x, y, w, h = _pad(_clamp_to(_union(near), box, line_height))
        if w * h > box.w * box.h * MAX_GROWTH:
            fitted[box.name], sources[box.name] = box, "nominal"
            continue
        fitted[box.name] = FieldBox(box.name, x=x, y=y, w=w, h=h, kind=box.kind)
        sources[box.name] = "snapped"
    return fitted, sources


def structural(lines: list[Line], size: tuple[int, int], *, wanted: set[str]) -> dict[str, FieldBox]:
    """Locate fields by what they contain rather than by where they sit."""
    found: dict[str, list[tuple[float, float, float, float]]] = {}
    for region in _prepare(lines, size):
        rect, text = region.rect, region.text
        folded = to_western_digits(text)
        if "nationalId" in wanted and _carries_a_national_id(folded):
            found.setdefault("nationalId", []).append(rect)
        if "nationalIdExpiry" in wanted and _FULL_DATE.search(folded):
            found.setdefault("nationalIdExpiry", []).append(rect)
        for name, terms in (("religion", _RELIGION_TERMS), ("maritalStatus", _MARITAL_TERMS)):
            if name in wanted and _mentions(text, terms):
                found.setdefault(name, []).append(rect)

    return {
        name: FieldBox(name, *_pad(rects[0]), kind=_KIND.get(name, "text"))
        for name, rects in found.items()
        if len(rects) == 1
    }


def anchor(
    boxes: tuple[FieldBox, ...], lines: list[Line], size: tuple[int, int]
) -> Anchoring:
    """Snap every box, then let structural identification override where it applies."""
    if not lines:
        return Anchoring({box.name: box for box in boxes}, {box.name: "nominal" for box in boxes})

    fitted, sources = snap(boxes, lines, size)
    for name, box in structural(lines, size, wanted={box.name for box in boxes}).items():
        fitted[name], sources[name] = box, "structural"
    return Anchoring(fitted, sources)
