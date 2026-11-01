"""Turning a photo upright by reading it.

The fake recognizer here stands in for PaddleOCR the way the real one behaves: text that is the
right way up reads confidently, text upside down reads as low-confidence garbage, and a photo on
its side produces TALL line boxes. A marker block in the photo's top-left corner says which way up
the fake is looking at it, so every rotation is checkable without a model.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.orientation import turn, upright  # noqa: E402


def _photo() -> np.ndarray:
    """A landscape page with a dark marker in its top-left corner when upright."""
    image = np.full((400, 600, 3), 230, np.uint8)
    image[10:60, 10:60] = 0
    return image


def _corner(image: np.ndarray) -> str:
    """Which corner holds the marker: 'tl', 'tr', 'br' or 'bl'."""
    height, width = image.shape[:2]
    corners = {
        "tl": image[: height // 4, : width // 4],
        "tr": image[: height // 4, -width // 4 :],
        "br": image[-height // 4 :, -width // 4 :],
        "bl": image[-height // 4 :, : width // 4],
    }
    return min(corners, key=lambda key: float(corners[key].mean()))


class _Reader:
    """Reads well only when upright; reports tall boxes when the photo is on its side."""

    def __init__(self) -> None:
        self.calls = 0

    def detect_lines(self, image):  # noqa: ANN001
        self.calls += 1
        height, width = image.shape[:2]
        sideways = height > width
        if sideways:
            box = [[0, 0], [20, 0], [20, 200], [0, 200]]
        else:
            box = [[0, 0], [200, 0], [200, 20], [0, 20]]
        if _corner(image) == "tl" and not sideways:
            return [(box, "قراءة واضحة تماما", 0.95)] * 4
        return [(box, "؟؟", 0.45)] * 4


def test_an_upright_photo_is_left_alone_after_one_read():
    reader = _Reader()
    image, turned = upright(_photo(), reader)
    assert turned == 0 and image.shape == _photo().shape
    assert reader.calls == 1, "a confidently-read upright photo needs no second read"


def test_an_upside_down_photo_is_turned_over():
    image, turned = upright(turn(_photo(), 180), _Reader())
    assert turned == 180
    assert _corner(image) == "tl"


def test_a_photo_on_either_side_is_stood_up():
    for applied, expected_fix in ((90, 270), (270, 90)):
        image, turned = upright(turn(_photo(), applied), _Reader())
        assert turned == expected_fix, f"photo turned {applied} was fixed by {turned}"
        assert image.shape[:2] == _photo().shape[:2] and _corner(image) == "tl"


def test_no_text_means_no_turn():
    class _Blank:
        def detect_lines(self, image):  # noqa: ANN001, ARG002
            return []

    image = turn(_photo(), 90)
    assert upright(image, _Blank()) == (image, 0)


def test_a_reader_that_cannot_tell_keeps_the_photo_as_given():
    """Equal evidence both ways up is not evidence to turn."""

    class _Indifferent:
        def detect_lines(self, image):  # noqa: ANN001, ARG002
            return [([[0, 0], [200, 0], [200, 20], [0, 20]], "نص", 0.6)]

    _, turned = upright(_photo(), _Indifferent())
    assert turned == 0


def test_a_recognizer_without_page_reading_leaves_the_photo_alone():
    image = turn(_photo(), 180)
    assert upright(image, object()) == (image, 0)
