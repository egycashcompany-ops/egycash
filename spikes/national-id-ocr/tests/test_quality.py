"""The capture gate: does this photograph carry enough signal to be worth reading?

The failure this guards against is not a crash. It is a 200 px-wide photograph of a card producing
fourteen confident digits that belong to nobody, and a reviewer accepting them because they look
like a national ID. Nothing downstream can catch that — the information was never in the pixels —
so it has to be caught here, and it has to be caught in a way the user can act on.

Two properties matter and both are tested: that the reasons are SPECIFIC (a user told "too small"
moves closer, a user told "unreadable" retakes the same photograph), and that a poor capture caps
confidence rather than discarding the read.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from nidocr.geometry import rectify  # noqa: E402
from nidocr.quality import QualityReport, assess, contrast, glare, sharpness  # noqa: E402
from scenes import DISTANT, FLAT, compose  # noqa: E402

FIXTURES = ROOT / "fixtures" / "synthetic"
CANONICAL = (1024, 646)

pytestmark = pytest.mark.skipif(
    not (FIXTURES / "synthetic-000-front.jpg").exists(), reason="run `make fixtures` first"
)


def _card() -> np.ndarray:
    return cv2.imread(str(FIXTURES / "synthetic-000-back.jpg"))


def _assess_scene(**kwargs) -> QualityReport:
    return assess(rectify(compose(_card(), **kwargs), CANONICAL))


# ── The verdict tracks the capture ──


def test_a_good_capture_passes_cleanly():
    report = _assess_scene(quad=FLAT, background="sand")
    assert report.verdict == "ok"
    assert report.reasons == ()
    assert report.confidence_ceiling == "high"


def test_a_card_too_small_in_frame_says_so():
    """The reason has to name the fixable thing. 'too_small' means 'move closer'."""
    report = _assess_scene(quad=DISTANT, background="sand")
    assert "too_small" in report.reasons
    assert report.verdict == "reject"


def test_a_blurred_capture_is_caught():
    blurred = cv2.GaussianBlur(_card(), (0, 0), sigmaX=6)
    report = assess(rectify(blurred, CANONICAL))
    assert "blurred" in report.reasons


def test_glare_is_measured_as_blobs_not_stray_bright_pixels():
    """A card's own pale stock is not glare. A reflection that swallowed a field is.

    Measuring raw bright pixels would flag every well-lit capture of pale card stock, which would
    make the warning meaningless. Only a contiguous blown-out region counts.
    """
    speckled = _card().copy()
    rng = np.random.default_rng(0)
    ys = rng.integers(0, speckled.shape[0], 4000)
    xs = rng.integers(0, speckled.shape[1], 4000)
    speckled[ys, xs] = 255
    assert glare(speckled) < 0.01, "scattered bright pixels are not glare"

    flared = _card().copy()
    cv2.circle(flared, (500, 300), 150, (255, 255, 255), -1)
    assert glare(flared) > 0.05, "a large blown-out region is glare"


# ── What the verdict does, and does not, do ──


def test_a_rejected_capture_is_still_read_but_capped():
    """Rejection shapes confidence; it does not throw the read away.

    Some fields survive a poor capture, the reviewer has the card in hand either way, and a
    partly-filled form beats an empty one. Equally, these thresholds are reasoned priors rather
    than measurements — so the failure mode when one is wrong should be a mis-ranked confidence,
    not a readable card silently discarded.
    """
    rejected = QualityReport("reject", ("blurred",), {})
    assert not rejected.readable
    assert rejected.confidence_ceiling == "low"

    degraded = QualityReport("degraded", ("too_small",), {})
    assert degraded.readable
    assert degraded.confidence_ceiling == "medium"


def test_an_already_cropped_scan_is_not_reported_as_a_missing_card():
    """The most ordinary input must not raise a warning.

    Flagging every pre-cropped scan as 'card_not_located' would fire constantly on the common path
    and train everyone to ignore the warning — at which point it stops working for the case it
    exists for.
    """
    report = assess(rectify(_card(), CANONICAL))
    assert "card_not_located" not in report.reasons


def test_metrics_are_reported_even_when_the_verdict_passes():
    """The numbers are the tuning input. They have to be visible before anyone can calibrate."""
    report = _assess_scene(quad=FLAT, background="sand")
    assert {"cardWidthPx", "sharpness", "glare", "contrast"} <= set(report.metrics)
    assert report.as_dict()["metrics"]["cardWidthPx"] > 0


def test_measures_are_taken_on_the_card_not_the_frame():
    """A 12 MP photo of a distant card is not sharp, however sharp the background is.

    Measuring the source frame would call it sharp and pass a capture with no readable text on it,
    which is exactly the confident-garbage case this module exists to prevent.
    """
    distant = compose(_card(), DISTANT, background="sand")
    assert sharpness(rectify(distant, CANONICAL).image) < sharpness(_card())
    assert contrast(_card()) > 0
