"""Where the text actually is on a card — the measurement the field boxes were missing.

The built-in geometry in `layout.py` was derived from synthetic fixtures, and the first real
Egyptian card showed what that is worth: the address box caught two lines and joined them out of
order, the national-ID box caught a single digit, and the rest landed on blank card. Guessing
corrections from those symptoms would be the same mistake a second time. This module measures
instead.

It runs detection over the WHOLE rectified card and reports each detected text line as a
normalized rectangle — **with no text**. That is the point: correcting the field boxes needs
coordinates, not content, so a card can be diagnosed and the numbers shared without any of the
holder's data leaving the container. What each region carries besides its rectangle is
deliberately minimal and non-identifying:

  * `chars`     — how many characters the line holds. Distinguishes a 14-digit ID from a 4-digit
                  year without revealing either.
  * `digits`    — whether the line is entirely digits once Arabic-Indic numerals are folded. The
                  national ID and the expiry date are the only all-digit lines on the card, and
                  their character counts separate them.
  * `confidence`— the recognizer's own score, so a region that is a smudge rather than a line can
                  be discounted when fitting boxes to it.

`cardDetected` reports whether rectification found a quad or fell back to resizing the frame.
That fallback is silent by design (a caller who already cropped to the card needs it), but it
means "boxes are misaligned" and "the card was never located" produce identical symptoms — and
they have completely different fixes. One bit resolves it.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from .arabic import to_western_digits
from .engine import Recognizer
from .layout import BACK_FIELDS, CANONICAL_SIZE, FRONT_FIELDS, FieldBox
from .preprocess import find_card_quad, load_bgr, prepare_card


@dataclass(frozen=True)
class Region:
    """One detected text line, as fractions of the rectified card. Never carries the text."""

    x: float
    y: float
    w: float
    h: float
    chars: int
    digits: bool
    confidence: float


def _normalize(poly: Any, size: tuple[int, int]) -> tuple[float, float, float, float] | None:
    """A detection polygon → a normalized axis-aligned rectangle.

    Detection returns quadrilaterals, which may be slightly rotated; the bounding box is what a
    field crop would need anyway, so the rotation is folded away here rather than carried.
    """
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
    return round(left, 4), round(top, 4), round(right - left, 4), round(bottom - top, 4)


def _boxes_as_dicts(boxes: tuple[FieldBox, ...]) -> list[dict[str, Any]]:
    return [asdict(box) for box in boxes]


def diagnose(path: str, recognizer: Recognizer) -> dict[str, Any]:
    """Measure one card: where its text lines sit, and whether it was located at all."""
    original = load_bgr(path)
    card_detected = find_card_quad(original) is not None
    card = prepare_card(original)
    height, width = card.shape[0], card.shape[1]

    regions: list[Region] = []
    for poly, text, score in recognizer.detect_lines(card):
        rect = _normalize(poly, (width, height))
        if rect is None:
            continue
        folded = to_western_digits(text).strip()
        regions.append(
            Region(
                x=rect[0],
                y=rect[1],
                w=rect[2],
                h=rect[3],
                chars=len(folded),
                digits=bool(folded) and folded.isdigit(),
                confidence=round(float(score), 3),
            )
        )

    # Reading order top-to-bottom, then start-to-end: makes the output scannable by eye when
    # matching regions against a card held next to it.
    regions.sort(key=lambda r: (r.y, r.x))

    return {
        "cardDetected": card_detected,
        "canonicalSize": [width, height],
        "regionCount": len(regions),
        "regions": [asdict(region) for region in regions],
        "currentBoxes": {
            "front": _boxes_as_dicts(FRONT_FIELDS),
            "back": _boxes_as_dicts(BACK_FIELDS),
            "canonicalSize": list(CANONICAL_SIZE),
        },
    }
