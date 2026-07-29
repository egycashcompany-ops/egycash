"""Move the field boxes onto the text that is actually there.

The field-box approach assumes the card's print geometry is fixed, and it is — but only for one
card design, rectified perfectly. Neither assumption survives contact with real captures:

  * Rectification is good, not exact. A few pixels of corner error, a residual degree of skew, or a
    card whose curl the dewarp only partly removed, and every box sits slightly off its line.
  * Egypt has issued more than one card design. The 2007-era cards still in circulation put their
    fields in different places from current stock, and a profile calibrated on one lands on blank
    laminate on the other.
  * A profile is calibrated from a handful of cards. Print tolerance across issuing offices and
    across a decade is wider than that sample.

A box that misses returns an empty string, which in an accuracy table is indistinguishable from
"the model cannot read Arabic" — and the two have completely different fixes. So rather than
trusting the geometry, this module uses it as a *prior* and corrects it against what detection
actually found on the card.

Two mechanisms, in increasing order of independence from the layout:

  1. **Snapping** keeps the nominal box's identity but takes its extent from the detected lines
     near it. This absorbs the small errors — a few percent of drift — that are otherwise fatal.
  2. **Structural assignment** ignores geometry altogether for the two fields whose content
     identifies them: a line of exactly fourteen digits is the national ID wherever it is printed,
     and a full year/month/day is the expiry. This is what lets an unfamiliar card design still
     yield its most important field.

Both refuse to act when the evidence is ambiguous, for the same reason the rest of the pipeline
does: a field left visibly rough gets re-read by the reviewer, and a field confidently filled with
the wrong value does not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import numpy as np

from .arabic import to_western_digits
from .layout import FieldBox

#: A detected line as the recognizers report it: (polygon, text, score).
Line = tuple[Any, str, float]


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


def _overlaps(rect: tuple[float, float, float, float], box: FieldBox, margin: float) -> bool:
    """Is this line's centre inside the box, allowed to have drifted by `margin` of the box size?

    Centre containment rather than rectangle intersection: a long address line legitimately extends
    past a conservatively-drawn box, and intersection would then also catch the neighbouring line
    that merely grazes the box's edge. The centre is where the line *is*.
    """
    x, y, w, h = rect
    centre_x, centre_y = x + w / 2.0, y + h / 2.0
    return (
        box.x - box.w * margin <= centre_x <= box.x + box.w * (1.0 + margin)
        and box.y - box.h * margin <= centre_y <= box.y + box.h * (1.0 + margin)
    )


def _union(rects: list[tuple[float, float, float, float]]) -> tuple[float, float, float, float]:
    left = min(r[0] for r in rects)
    top = min(r[1] for r in rects)
    right = max(r[0] + r[2] for r in rects)
    bottom = max(r[1] + r[3] for r in rects)
    return left, top, right - left, bottom - top


def _pad(
    rect: tuple[float, float, float, float], amount: float = 0.04
) -> tuple[float, float, float, float]:
    """Grow a rect slightly. Detection polygons hug the ink, and a crop taken exactly on that
    boundary shaves the ascenders and the dots off the top line — which is the same information
    loss the whole pipeline is trying to avoid."""
    x, y, w, h = rect
    grow_x, grow_y = w * amount, h * amount
    return (
        max(0.0, x - grow_x),
        max(0.0, y - grow_y),
        min(1.0 - max(0.0, x - grow_x), w + 2 * grow_x),
        min(1.0 - max(0.0, y - grow_y), h + 2 * grow_y),
    )


#: A crop that grew past this multiple of its nominal area has almost certainly swallowed the
#: neighbouring field. Recognizing two fields as one produces a confident string that is wrong in a
#: way no confidence score reflects, so the snap is abandoned and the nominal box kept.
MAX_GROWTH = 2.5

_FULL_DATE = re.compile(r"\d{4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2}")


def snap(
    boxes: tuple[FieldBox, ...], lines: list[Line], size: tuple[int, int], *, margin: float = 0.35
) -> tuple[dict[str, FieldBox], dict[str, str]]:
    """Fit each nominal box to the detected lines around it."""
    rects = [rect for rect in (_rect(poly, size) for poly, _, _ in lines) if rect is not None]

    fitted: dict[str, FieldBox] = {}
    sources: dict[str, str] = {}
    for box in boxes:
        near = [rect for rect in rects if _overlaps(rect, box, margin)]
        if not near:
            fitted[box.name], sources[box.name] = box, "nominal"
            continue
        x, y, w, h = _pad(_union(near))
        if w * h > box.w * box.h * MAX_GROWTH:
            fitted[box.name], sources[box.name] = box, "nominal"
            continue
        fitted[box.name] = FieldBox(box.name, x=x, y=y, w=w, h=h, kind=box.kind)
        sources[box.name] = "snapped"
    return fitted, sources


def structural(lines: list[Line], size: tuple[int, int], *, wanted: set[str]) -> dict[str, FieldBox]:
    """Locate fields by what they contain rather than by where they sit.

    Only two fields on the card can be identified this way, and both are identified by shape alone
    rather than by any word that would have to be recognized correctly first:

      * `nationalId` — the only line on either side that folds to exactly fourteen digits.
      * `nationalIdExpiry` — the only line carrying a full year/month/day. The issue date printed
        beside it is year and month only, which is what keeps the two apart without reading the
        Arabic label next to either.

    A pattern matching more than one line yields nothing. Two fourteen-digit lines on one side means
    something has been misdetected, and choosing between them by position would reintroduce exactly
    the geometric assumption this function exists to avoid.
    """
    found: dict[str, list[tuple[float, float, float, float]]] = {}
    for poly, text, _ in lines:
        rect = _rect(poly, size)
        if rect is None:
            continue
        folded = to_western_digits(text)
        if "nationalId" in wanted and len(re.sub(r"\D", "", folded)) == 14:
            found.setdefault("nationalId", []).append(rect)
        if "nationalIdExpiry" in wanted and _FULL_DATE.search(folded):
            found.setdefault("nationalIdExpiry", []).append(rect)

    return {
        name: FieldBox(name, *_pad(rects[0]), kind="digits")
        for name, rects in found.items()
        if len(rects) == 1
    }


def anchor(
    boxes: tuple[FieldBox, ...], lines: list[Line], size: tuple[int, int]
) -> Anchoring:
    """Snap every box, then let structural identification override where it applies.

    Structural wins over snapping deliberately. Snapping still assumes the nominal box was roughly
    right — it only corrects drift — whereas a fourteen-digit line is the national ID no matter
    what the profile believed, which is precisely the case where the profile is most wrong.
    """
    if not lines:
        return Anchoring({box.name: box for box in boxes}, {box.name: "nominal" for box in boxes})

    fitted, sources = snap(boxes, lines, size)
    for name, box in structural(lines, size, wanted={box.name for box in boxes}).items():
        fitted[name], sources[name] = box, "structural"
    return Anchoring(fitted, sources)
