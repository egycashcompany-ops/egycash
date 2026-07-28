"""Digit fields are read twice and the better read wins.

Binarizing digit crops was a defensible default taken from synthetic fixtures, where the number
sits on clean card stock. A real Egyptian ID prints it over the pyramid watermark, and adaptive
thresholding fragments the glyphs against that background — which is how a 14-digit number came
back as four digits while every other field on the card read correctly.

The fix is not to flip the default. Thresholding genuinely helps on a clean scan, so either choice
is wrong for half the inputs. Both are run and the winner is chosen by how many digits survived —
which for a field of known shape is a real quality measure, not a guess.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.engine import Recognition  # noqa: E402
from nidocr.extract import _recognize_box  # noqa: E402
from nidocr.layout import FieldBox  # noqa: E402
from nidocr.preprocess import binarize  # noqa: E402


class SplitByThreshold:
    """Returns a poor read for the binarized crop and a good one otherwise.

    Distinguishes the two by a property binarization actually changes — an adaptive threshold
    leaves only 0 and 255 — rather than by call order, so the test cannot pass by accident if the
    two reads are ever reordered.
    """

    id = "split-by-threshold"

    def __init__(self, thresholded: str, plain: str) -> None:
        self.thresholded, self.plain = thresholded, plain
        self.calls = 0

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:  # noqa: ARG002
        self.calls += 1
        is_binary = set(np.unique(crop)).issubset({0, 255})
        return Recognition(text=self.thresholded if is_binary else self.plain, score=0.9)

    def detect_lines(self, image: np.ndarray):  # noqa: ARG002
        return []


@pytest.fixture()
def card():
    """A mid-grey card — not already binary, so thresholding is detectable."""
    rng = np.random.default_rng(3)
    return rng.integers(60, 200, size=(646, 1024, 3), dtype=np.uint8)


def test_prefers_whichever_read_recovers_more_digits(card):
    box = FieldBox("nationalId", x=0.37, y=0.745, w=0.60, h=0.135, kind="digits")
    recognizer = SplitByThreshold(thresholded="2964", plain="29610141400551")
    text, _ = _recognize_box(card, box, recognizer)
    assert text == "29610141400551"
    assert recognizer.calls == 2, "a digit field must be read both ways"


def test_thresholding_still_wins_when_it_reads_better(card):
    """The point is choosing per input, not preferring one path."""
    box = FieldBox("nationalId", x=0.37, y=0.745, w=0.60, h=0.135, kind="digits")
    recognizer = SplitByThreshold(thresholded="29610141400551", plain="296")
    text, _ = _recognize_box(card, box, recognizer)
    assert text == "29610141400551"


def test_text_fields_are_read_once(card):
    """The extra pass buys nothing for Arabic prose, and costs a recognition per field."""
    box = FieldBox("fullNameAr", x=0.52, y=0.255, w=0.45, h=0.20, kind="text")
    recognizer = SplitByThreshold(thresholded="x", plain="y")
    _recognize_box(card, box, recognizer)
    assert recognizer.calls == 1


def test_binarize_really_does_produce_a_two_valued_image(card):
    """Guards the discriminator the tests above rely on."""
    assert set(np.unique(binarize(card))).issubset({0, 255})
