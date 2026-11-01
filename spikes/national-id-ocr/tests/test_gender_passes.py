"""The printed sex word, found in any read of the back, is held against the number's parity digit."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.extract import _printed_gender, _side_text_lines  # noqa: E402
from nidocr.extract import SideResult  # noqa: E402
from nidocr.rows import RowRead, _merge  # noqa: E402


def _read(*texts: str, label: str) -> RowRead:
    return RowRead(lines=[(None, text, 0.9) for text in texts], passes=[label])


def test_a_sex_word_only_the_zoomed_pass_read_is_kept():
    merged = _merge([_read("مسلم", "متزوج", label="photo"), _read("انثى", "مسلمة", label="zoomed x2")])
    assert _printed_gender(merged.lines) is None  # the first pass alone has no sex word
    assert _printed_gender(merged.lines + merged.pass_lines) == "انثى"


def test_the_first_pass_lines_are_unchanged_so_line_counts_do_not_inflate():
    merged = _merge([_read("a", "b", label="photo"), _read("c", label="enhanced")])
    assert [text for _, text, _ in merged.lines] == ["a", "b"]


def test_the_side_text_lines_include_every_pass():
    side = SideResult(lines=[(None, "مسلم", 0.9)], pass_lines=[(None, "ذكر", 0.9)])
    assert _printed_gender(_side_text_lines(side)) == "ذكر"
