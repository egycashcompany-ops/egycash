"""Cutting a field crop into printed lines, without asking a detector where they are.

WHY THIS REPLACED DETECTION ON THIS PATH. Handing a field crop to a full OCR pipeline runs text
detection inside it, and detection returns the words it is confident about — so a word it is not
confident about is simply absent from the result. The field then comes back missing a word from the
MIDDLE of a line with every word around it correct, correctly read and correctly ordered. There is
no low score to notice, no gap in the string, no structural check that fires. A card printing a
six-part name returned three of them, and the missing three were the first, the third and the last:
a pattern no crop can produce, because a crop cannot remove the third word while keeping the second
and the fourth.

Detection is the wrong tool at this point anyway. Its job is to find text on a page; the field box
has already done that. What remains is deciding where one printed line ends and the next begins,
and a projection profile answers exactly that — sum the ink per row, and the valleys between the
peaks are the gaps between lines. The recognizer then reads each strip whole, so every glyph on the
line reaches it with no per-word threshold anywhere in the path.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.preprocess import split_text_lines, trim_to_ink  # noqa: E402


def _card(width: int = 600, height: int = 200) -> np.ndarray:
    """Light card stock, the way a rectified crop arrives."""
    return np.full((height, width, 3), 235, np.uint8)


def _write(image: np.ndarray, *, top: int, bottom: int, left: int = 20, right: int = 580) -> None:
    """A band of thin dark strokes standing in for a printed line.

    Strokes, not a solid block: ink is found by its local contrast (`text_ink`), which is what
    separates print from the picture behind it on a real card, and print is made of strokes.
    """
    for x in range(left, right + 1, 6):
        cv2.line(image, (x, top), (x, bottom), (40, 40, 40), thickness=2)


# ── Finding the lines ──


def test_two_printed_lines_come_back_as_two_strips():
    image = _card()
    _write(image, top=30, bottom=60)
    _write(image, top=120, bottom=150)

    strips = split_text_lines(image)
    assert len(strips) == 2
    assert all(strip.shape[0] > 0 for strip in strips)


def test_a_two_line_name_with_tight_leading_is_split():
    """The real failure: a name box ~130 px tall holding two lines ~35 px high, 7 px apart.

    The merge threshold used to scale with the CROP, so this gap was treated as one line and the
    model was handed both lines squashed into one 48 px strip.
    """
    image = _card(height=130)
    _write(image, top=30, bottom=65)
    _write(image, top=73, bottom=105)

    strips = split_text_lines(image)
    assert len(strips) == 2
    assert all(strip.shape[0] < 60 for strip in strips)


def test_the_strips_are_returned_top_to_bottom():
    """Reading order for every field on this card, and the reason nothing re-sorts them later.

    Each strip is one line, read whole by a model that already emits Arabic in logical order — so
    there are no fragments to sequence and no opportunity to sequence them wrongly. That is what
    removes the last place RTL handling could reorder or drop part of a name.
    """
    image = _card()
    _write(image, top=20, bottom=45, left=20, right=200)  # narrow: the first line
    _write(image, top=120, bottom=145, left=20, right=580)  # wide: the second

    first, second = split_text_lines(image)
    assert first.shape[0] < image.shape[0] and second.shape[0] < image.shape[0]
    # The narrow line has less ink; finding it first proves the order is vertical, not by size.
    assert (first < 128).sum() < (second < 128).sum()


def test_a_line_is_not_split_by_the_gap_under_a_descender():
    """Arabic drops ج, ع and م below the baseline, leaving a gap inside a single line.

    Treating every valley as a line break would cut one printed line into two strips and read the
    descenders as their own line of nonsense.
    """
    image = _card()
    _write(image, top=40, bottom=70)  # the body of the line
    _write(image, top=74, bottom=86, left=60, right=180)  # descenders, just below it

    assert len(split_text_lines(image)) == 1


def test_a_single_line_comes_back_whole():
    image = _card()
    _write(image, top=80, bottom=115)
    strips = split_text_lines(image)

    assert len(strips) == 1
    assert strips[0].shape == image.shape, "a single line must not be trimmed"


# ── Falling back rather than returning nothing ──


def test_blank_card_is_returned_unchanged():
    """One line read as one line is the behaviour to fall back to, never zero lines."""
    strips = split_text_lines(_card())
    assert len(strips) == 1 and strips[0].shape == _card().shape


def test_a_crop_full_of_texture_falls_back_to_the_whole_crop():
    """Guilloche, a photograph edge, a barcode: no clean profile, so no confident split.

    Returning the crop whole is exactly the old behaviour, which is the right thing to degrade to.
    """
    rng = np.random.default_rng(11)
    noise = rng.integers(0, 255, size=(200, 600, 3), dtype=np.uint8)
    strips = split_text_lines(noise)
    assert len(strips) == 1


def test_more_lines_than_a_field_can_hold_is_refused():
    """A crop resolving into a dozen bands is measuring texture, not print."""
    image = _card(height=400)
    for index in range(12):
        _write(image, top=10 + index * 30, bottom=20 + index * 30)
    assert len(split_text_lines(image)) == 1


def test_a_tiny_crop_is_returned_as_is():
    assert len(split_text_lines(np.full((4, 4, 3), 200, np.uint8))) == 1


# ── The property the whole change rests on ──


def test_every_row_of_the_crop_survives_into_some_strip():
    """Nothing between the first line's top and the last line's bottom may be dropped.

    A word is lost the moment its pixels are not in any strip handed to the recognizer, and that
    loss is invisible downstream — which is the failure this replaced. The splitter is allowed to
    discard blank margins; it is not allowed to discard ink.
    """
    image = _card()
    _write(image, top=30, bottom=60)
    _write(image, top=120, bottom=150)

    ink_before = int((cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) < 128).sum())
    ink_after = sum(
        int((cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY) < 128).sum())
        for strip in split_text_lines(image)
    )
    assert ink_after == ink_before, "the splitter dropped printed pixels"


# ── Trimming a strip to its ink ──


def test_a_short_line_is_trimmed_to_its_ink_with_a_margin():
    """A given name alone at the right end of a field-wide strip: the blank card beside it goes.

    The real model transcribed that blank card as Latin letters ('GNERRLEMGTRRHحم').
    """
    strip = _card(width=600, height=40)
    _write(strip, top=8, bottom=30, left=500, right=580)

    trimmed = trim_to_ink(strip)
    assert trimmed.shape[0] == strip.shape[0]
    assert trimmed.shape[1] < 200
    ink = lambda image: int((cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) < 128).sum())  # noqa: E731
    assert ink(trimmed) == ink(strip), "trimming dropped printed pixels"


def test_a_blank_strip_is_not_trimmed_away():
    strip = _card(width=600, height=40)
    assert trim_to_ink(strip).shape == strip.shape


def test_two_lines_printed_over_a_picture_are_still_split():
    """The front of a real card prints the name over a photograph of the pyramids.

    The picture's shading is as dark as some strokes, so "dark pixels per row" found ink in every
    row and the name's two lines came back as one strip. Ink is now print-like local contrast,
    which a broad shadow does not have.
    """
    image = _card(width=480, height=80)
    rows, columns = np.mgrid[0:80, 0:480]
    shadow = 120 * np.exp(-(((columns - 150) / 90.0) ** 2 + ((rows - 40) / 45.0) ** 2))
    image = np.clip(image.astype(float) - shadow[..., None], 0, 255).astype(np.uint8)
    _write(image, top=14, bottom=36, left=250, right=460)
    _write(image, top=46, bottom=70, left=200, right=460)

    assert len(split_text_lines(image)) == 2, "the picture behind the name merged its two lines"
