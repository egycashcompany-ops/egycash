"""Is this capture good enough to read at all?

The pipeline's worst behaviour is not failing — it is succeeding quietly on an image nothing could
have been read from. A 200 px-wide photo of a card still produces fourteen digits; they are simply
not the right fourteen. A reviewer who is handed a plausible-looking number does not re-derive it
from a blurred photograph, they accept it. That is how a bad capture becomes a wrong employee
record, and no amount of recognizer accuracy prevents it, because the information was never in the
pixels.

So this module runs first and answers a different question from "what does the card say": it asks
whether the capture carries enough signal to be worth reading, and when it does not, it says which
property failed. That distinction is the whole point. "Could not read the card" makes a user
retake the same bad photo the same way. "The card is too small in the frame — move closer" gets a
readable photo on the second attempt.

Verdicts are three-valued, not two. Plenty of real captures are marginal: readable, but not
trustworthy without a second look. Collapsing those into `ok` overstates confidence, and collapsing
them into `reject` sends people back to the camera for an image that would have worked.

**Message copy does not live here.** These are machine codes; the API and the web app own the
wording and its translation, exactly as they do for every other error the service returns.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import cv2
import numpy as np

from .geometry import ID1_ASPECT, Rectification


def _threshold(name: str, default: float) -> float:
    """Read a tunable from the environment.

    Every number in this module is a prior, not a measurement — they were reasoned from the card's
    print geometry and PP-OCR's input sizing, not fitted to a corpus of real Egyptian captures,
    because no such corpus has been measured yet. Making them settable means the first person to
    run this against real cards can tune the gate without a rebuild, and `bench/` can sweep them.
    """
    raw = os.environ.get(f"OCR_QUALITY_{name}")
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


#: Card width in source pixels. The national ID row spans ~60% of the card and holds 14 digits, so
#: at 600 px of card width each digit gets ~26 px of width and ~50 px of height — around the floor
#: at which PP-OCR's recognition input stops being interpolation. Below 900 it works but the margin
#: for a smudge or a fold is gone, which is what `degraded` means.
MIN_CARD_WIDTH_PX = _threshold("MIN_CARD_WIDTH", 600.0)
GOOD_CARD_WIDTH_PX = _threshold("GOOD_CARD_WIDTH", 800.0)

#: Variance of the Laplacian, measured on the canonical 1024 px card so the number is comparable
#: across captures regardless of the source camera.
MIN_SHARPNESS = _threshold("MIN_SHARPNESS", 40.0)
GOOD_SHARPNESS = _threshold("GOOD_SHARPNESS", 120.0)

#: Fraction of the card lost to specular highlight. Laminated cards under a ceiling light routinely
#: give 1-2% and stay readable; a flash reflection that swallows a field is well above 6%.
MAX_GLARE = _threshold("MAX_GLARE", 0.12)
GOOD_GLARE = _threshold("GOOD_GLARE", 0.04)

#: 5th-95th percentile luminance spread, normalized. Under-exposed captures collapse this.
#:
#: The reject floor is set low deliberately. Card contrast varies enormously with stock, wear and
#: lighting — the front of a pale card photographed in shade legitimately measures around 0.11,
#: which is perfectly readable — so a floor set where "good" begins would send people back to the
#: camera for captures that would have worked. A false reject costs a retake and trust in the
#: feature; a false accept is caught downstream by the reviewer and the structural checks. So this
#: is tuned to catch the genuinely hopeless — an all-but-flat frame — and to warn about the rest.
MIN_CONTRAST = _threshold("MIN_CONTRAST", 0.06)
GOOD_CONTRAST = _threshold("GOOD_CONTRAST", 0.10)

#: How far the located card's proportions may sit from ID-1 before the localization is suspect.
#: A quad that passed detection but measures well off ratio usually means a partly occluded card.
MAX_ASPECT_ERROR = _threshold("MAX_ASPECT_ERROR", 0.22)


@dataclass(frozen=True)
class QualityReport:
    """Whether the capture is readable, and — when it is not — precisely what is wrong with it."""

    #: 'ok' | 'degraded' | 'reject'.
    verdict: str
    #: Machine codes, worst first: 'card_not_located' | 'too_small' | 'blurred' | 'glare' |
    #: 'low_contrast' | 'bad_aspect'. Empty when the verdict is 'ok'.
    reasons: tuple[str, ...] = ()
    metrics: dict[str, float] = field(default_factory=dict)

    @property
    def readable(self) -> bool:
        """Whether the caller should trust this capture or ask for another one.

        Note what this does NOT mean: extraction always runs. A refused capture still gets read,
        and its fields still come back — capped at `low`, with these reasons attached. Two things
        drove that.

        Skipping the read throws away information for free. Some fields survive a bad capture, the
        reviewer has the card in their hand either way, and a partly-filled form they correct beats
        an empty one they type from scratch.

        And the thresholds here are reasoned priors, not measurements — nobody has yet run this
        against a corpus of real Egyptian captures. A threshold that merely mis-ranks confidence
        when it is wrong is a small error; one that silently discards a readable card is a
        feature that looks broken. Capping confidence keeps the gate useful while it is still a
        guess, which is the honest place to put an untuned number.
        """
        return self.verdict != "reject"

    @property
    def confidence_ceiling(self) -> str:
        """The highest band any field from this capture may claim.

        A capture the gate called degraded cannot yield a `high` field however sure the model is
        about its own pixels: the model's score describes how cleanly it read what it was shown,
        not whether what it was shown carried the information. That gap is precisely what makes a
        blurred capture dangerous — recognition on mush is often *more* confident, not less,
        because mush has fewer competing hypotheses.
        """
        return {"ok": "high", "degraded": "medium", "reject": "low"}[self.verdict]

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "reasons": list(self.reasons),
            "metrics": {name: round(value, 4) for name, value in self.metrics.items()},
        }


def sharpness(card: np.ndarray) -> float:
    """Variance of the Laplacian — high for crisp edges, near zero for a smooth blur.

    Measured on the rectified card rather than the original frame, which makes it independent of
    how many megapixels the camera had: a 12 MP photo of a card 200 px across is not sharp, and
    measuring the source would call it sharp because the *background* is in focus.
    """
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def glare(card: np.ndarray) -> float:
    """Fraction of the card lost to specular highlight.

    Opened before measuring so that scattered near-white pixels — the card's own pale stock, the
    unprinted margin — do not register. What matters is a *blob* of blown-out pixels large enough
    to have swallowed a field; isolated bright pixels have swallowed nothing.
    """
    value = cv2.cvtColor(card, cv2.COLOR_BGR2HSV)[..., 2]
    blown = (value >= 250).astype(np.uint8)
    blown = cv2.morphologyEx(blown, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return float(blown.mean())


def contrast(card: np.ndarray) -> float:
    """Normalized 5th-95th percentile luminance spread.

    Percentiles rather than min/max or standard deviation: one blown highlight and one black speck
    would make min/max report full contrast on an image that is otherwise flat grey, and standard
    deviation is dragged around by the photograph on the front of the card.
    """
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY).astype(np.float32)
    low, high = np.percentile(gray, (5, 95))
    return float((high - low) / 255.0)


def assess(rectification: Rectification) -> QualityReport:
    """Judge one rectified capture.

    Ordering matters in the returned reasons: they are sorted so the most actionable failure comes
    first, because a user shown three problems fixes the first one. A card that was never located
    is reported ahead of everything else — the other metrics were computed over whatever the frame
    happened to contain, so they are describing the desk, not the card.
    """
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
        # Reported only for a genuine miss — a frame that is not itself card-shaped, in which a
        # card was there to be found and was not. An already-cropped scan does not come through
        # here (see `geometry.rectify`), because flagging those would fire on the most ordinary
        # input the feature has and teach everyone to ignore the warning.
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
