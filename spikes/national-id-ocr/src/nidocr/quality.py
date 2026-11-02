"""Is this capture good enough to read at all?"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import cv2
import numpy as np

from .geometry import ID1_ASPECT, Rectification


def _threshold(name: str, default: float) -> float:
    """Read a tunable from the environment."""
    raw = os.environ.get(f"OCR_QUALITY_{name}")
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


#: Card width in source pixels.
MIN_CARD_WIDTH_PX = _threshold("MIN_CARD_WIDTH", 450.0)
GOOD_CARD_WIDTH_PX = _threshold("GOOD_CARD_WIDTH", 700.0)

#: Variance of the Laplacian, measured on the canonical 1024 px card so the number is comparable
#: across captures regardless of the source camera.
MIN_SHARPNESS = _threshold("MIN_SHARPNESS", 40.0)
GOOD_SHARPNESS = _threshold("GOOD_SHARPNESS", 120.0)

#: Fraction of the card lost to specular highlight. Laminated cards under a ceiling light routinely
#: give 1-2% and stay readable; a flash reflection that swallows a field is well above 6%.
MAX_GLARE = _threshold("MAX_GLARE", 0.12)
GOOD_GLARE = _threshold("GOOD_GLARE", 0.08)

#: 5th-95th percentile luminance spread, normalized.
MIN_CONTRAST = _threshold("MIN_CONTRAST", 0.06)
GOOD_CONTRAST = _threshold("GOOD_CONTRAST", 0.10)

#: How far the located card's proportions may sit from ID-1 before the localization is suspect.
#: A quad that passed detection but measures well off ratio usually means a partly occluded card.
MAX_ASPECT_ERROR = _threshold("MAX_ASPECT_ERROR", 0.22)


@dataclass(frozen=True)
class QualityReport:
    """Whether the capture is readable, and, when it is not, precisely what is wrong with it."""

    #: 'ok' | 'degraded' | 'reject'.
    verdict: str
    #: Machine codes, worst first: 'card_not_located' | 'too_small' | 'blurred' | 'glare' |
    #: 'low_contrast' | 'bad_aspect'. Empty when the verdict is 'ok'.
    reasons: tuple[str, ...] = ()
    metrics: dict[str, float] = field(default_factory=dict)

    @property
    def readable(self) -> bool:
        """Whether the caller should trust this capture or ask for another one."""
        return self.verdict != "reject"

    @property
    def confidence_ceiling(self) -> str:
        """The highest band any field from this capture may claim."""
        return {"ok": "high", "degraded": "medium", "reject": "low"}[self.verdict]

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "reasons": list(self.reasons),
            "metrics": {name: round(value, 4) for name, value in self.metrics.items()},
        }


def sharpness(card: np.ndarray) -> float:
    """Variance of the Laplacian, high for crisp edges, near zero for a smooth blur."""
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def glare(card: np.ndarray) -> float:
    """Fraction of the card lost to specular highlight."""
    value = cv2.cvtColor(card, cv2.COLOR_BGR2HSV)[..., 2]
    blown = (value >= 250).astype(np.uint8)
    blown = cv2.morphologyEx(blown, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return float(blown.mean())


def contrast(card: np.ndarray) -> float:
    """Normalized 5th-95th percentile luminance spread."""
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY).astype(np.float32)
    low, high = np.percentile(gray, (5, 95))
    return float((high - low) / 255.0)


def assess(rectification: Rectification) -> QualityReport:
    """Judge one rectified capture."""
    card = rectification.image
    metrics = {
        "cardWidthPx": rectification.card_width_px,
        "sharpness": sharpness(card),
        "glare": glare(card),
        "contrast": contrast(card),
        "bow": rectification.bow,
    }
    if rectification.aspect is not None:
        metrics["aspectError"] = abs(rectification.aspect / ID1_ASPECT - 1.0)

    rejects: list[str] = []
    degrades: list[str] = []

    if not rectification.located:
        # Reported only for a genuine miss, a frame that is not itself card-shaped, in which a
        # card was there to be found and was not.
        degrades.append("card_not_located")

    if metrics["cardWidthPx"] < MIN_CARD_WIDTH_PX:
        rejects.append("too_small")
    elif metrics["cardWidthPx"] < GOOD_CARD_WIDTH_PX:
        degrades.append("too_small")

    if metrics["sharpness"] < MIN_SHARPNESS:
        rejects.append("blurred")
    elif metrics["sharpness"] < GOOD_SHARPNESS:
        degrades.append("blurred")

    if metrics["glare"] > MAX_GLARE:
        rejects.append("glare")
    elif metrics["glare"] > GOOD_GLARE:
        degrades.append("glare")

    if metrics["contrast"] < MIN_CONTRAST:
        rejects.append("low_contrast")
    elif metrics["contrast"] < GOOD_CONTRAST:
        degrades.append("low_contrast")

    if metrics.get("aspectError", 0.0) > MAX_ASPECT_ERROR:
        degrades.append("bad_aspect")

    if rejects:
        return QualityReport("reject", tuple(rejects + degrades), metrics)
    if degrades:
        return QualityReport("degraded", tuple(degrades), metrics)
    return QualityReport("ok", (), metrics)
