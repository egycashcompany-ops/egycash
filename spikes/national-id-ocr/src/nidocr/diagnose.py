"""Where the text actually is on a card, the measurement the field boxes were missing."""

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
    """A detection polygon → a normalized axis-aligned rectangle."""
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
