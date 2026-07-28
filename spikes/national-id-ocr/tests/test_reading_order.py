"""Fragment ordering — the difference between a usable field and a shuffled one.

Three real cards came back with every word correct and the sequence meaningless: a name arrived
as its own words out of order, and an address as its own lines interleaved. Detection returns
fragments in its own order, and the pipeline was joining them as they arrived.

The direction is per-field, not global. Arabic names and addresses read right to left; the
national ID is a number whose spaced groups read left to right, on the same card, in the same
image. Getting that backwards produces a number with every digit correct in the wrong order —
which passes a glance, passes a length check, and is wrong.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nidocr.engine import _in_reading_order  # noqa: E402


def box(left: float, top: float, right: float, bottom: float) -> list[list[float]]:
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


#: Two printed lines of a name, handed over in an order detection might plausibly produce.
NAME_FRAGMENTS = [
    (box(300, 240, 420, 300), "شحاته", 0.93),
    (box(700, 140, 860, 200), "بولا", 0.95),
    (box(560, 240, 700, 300), "حنا", 0.91),
    (box(430, 240, 550, 300), "ابراهيم", 0.90),
    (box(720, 240, 860, 300), "خليل", 0.94),
]

#: One row of digit groups, shuffled. The leftmost group starts the number.
DIGIT_FRAGMENTS = [
    (box(560, 480, 660, 540), "14", 0.9),
    (box(180, 480, 380, 540), "29610", 0.9),
    (box(700, 480, 900, 540), "00551", 0.9),
    (box(420, 480, 520, 540), "14", 0.9),
]


def test_arabic_reads_right_to_left_across_two_lines():
    ordered = _in_reading_order(NAME_FRAGMENTS, rtl=True)
    assert " ".join(t for t, _ in ordered) == "بولا خليل حنا ابراهيم شحاته"


def test_digit_groups_read_left_to_right():
    ordered = _in_reading_order(DIGIT_FRAGMENTS, rtl=False)
    assert "".join(t for t, _ in ordered) == "29610141400551"


def test_reading_a_number_right_to_left_reverses_it():
    """Pinned as the failure it is: length and digits both survive, only the value is wrong."""
    wrong = "".join(t for t, _ in _in_reading_order(DIGIT_FRAGMENTS, rtl=True))
    right = "".join(t for t, _ in _in_reading_order(DIGIT_FRAGMENTS, rtl=False))
    assert wrong != right
    assert len(wrong) == len(right) and sorted(wrong) == sorted(right)


def test_rows_are_grouped_by_overlap_not_exact_baseline():
    """Words on one printed line rarely share a baseline pixel-for-pixel; a few px of jitter must
    not split them into separate rows and scramble the line order."""
    jittered = [
        (box(700, 141, 860, 199), "ثالث", 0.9),
        (box(500, 138, 660, 202), "ثاني", 0.9),
        (box(300, 143, 460, 197), "أول", 0.9),
    ]
    ordered = _in_reading_order(jittered, rtl=True)
    assert [t for t, _ in ordered] == ["ثالث", "ثاني", "أول"]


def test_empty_input_is_not_an_error():
    assert _in_reading_order([], rtl=True) == []


def test_unreadable_polygons_do_not_drop_their_text():
    """A malformed polygon should cost ordering accuracy, never the recognized text itself."""
    ordered = _in_reading_order([(None, "نص", 0.8)], rtl=True)
    assert [t for t, _ in ordered] == ["نص"]
