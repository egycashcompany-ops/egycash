"""Removing the card's own printed words, and refusing to remove anybody else's.

The reason this module exists is a trade the geometry cannot win. A field box tight enough to
exclude the header printed above the name is also tight enough to clip the first line of a name
that wraps differently — and the two failures are not equally bad. A header glued onto a name is
recoverable, because the phrase is identical on every card ever issued. A name whose first line was
cropped away is not recoverable by anything, and nothing downstream can even tell it is missing.

So the boxes are allowed to be generous and this cleans up after them. Which makes the false
positive — stripping something that was actually somebody's data — the failure that matters here,
and most of these tests are about the guards against it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.boilerplate import is_boilerplate, strip_boilerplate  # noqa: E402
from nidocr.postprocess import clean_address, clean_text  # noqa: E402

#: Invented. Every piece of card text in this repository has to be.
NAME = "سلمى إبراهيم عبد الرحمن السيد"


# ── Removing the furniture ──


@pytest.mark.parametrize(
    ("read", "expected"),
    [
        (f"بطاقة تحقيق الشخصية {NAME}", NAME),
        (f"جمهورية مصر العربية {NAME}", NAME),
        (f"{NAME} جمهورية مصر العربية", NAME),
        (f"جمهورية مصر العربية بطاقة تحقيق الشخصية {NAME}", NAME),
    ],
)
def test_the_printed_header_is_removed_from_a_name(read, expected):
    assert strip_boilerplate(read) == expected


def test_the_phrase_is_matched_through_dropped_dots():
    """Same reasoning as everywhere else in this pipeline: dots are what a recognizer loses first.

    A header read as 'بطاقه تحقيق الشخصيه' has been read correctly and punctuated wrongly, and it
    has to still count as the header — otherwise the one case the removal exists for, a slightly
    imperfect read, is the one case it fails on.
    """
    assert strip_boilerplate(f"بطاقه تحقيق الشخصيه {NAME}") == NAME


def test_a_label_and_its_value_keep_the_value():
    assert strip_boilerplate("البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤") == "٢٠٢٢/٠٧/٠٤"
    assert strip_boilerplate("الديانة مسلمة") == "مسلمة"


# ── Refusing ──


def test_a_single_word_of_a_phrase_is_never_removed_on_its_own():
    """The guard that makes this safe, and the reason matching is on token SEQUENCES.

    'مصر' is a word in real Cairo addresses — مصر الجديدة, مصر القديمة — and it is also the middle
    word of the state's name printed across the top of every card. Matching loose words would strip
    a district out of somebody's address; matching the whole phrase cannot, because no address
    contains 'جمهورية مصر العربية'.
    """
    address = "١٢ ش الثورة - مصر الجديدة - القاهرة"
    assert strip_boilerplate(address) == address
    assert clean_address(address)[0].endswith("القاهرة")


def test_a_partial_phrase_is_left_alone():
    """Two of three words matching is a coincidence far more often than it is a truncated header."""
    assert strip_boilerplate("جمهورية مصر") == "جمهورية مصر"


def test_a_name_survives_untouched():
    assert strip_boilerplate(NAME) == NAME
    assert clean_text(NAME) == NAME


# ── Which lines carry a field at all ──


@pytest.mark.parametrize(
    "line", ["بطاقة تحقيق الشخصية", "جمهورية مصر العربية", "  الديانة  "]
)
def test_a_line_of_nothing_but_furniture_is_recognised_as_such(line):
    """These lines are dropped before anchoring, so no field box can be pulled onto them."""
    assert is_boilerplate(line)


@pytest.mark.parametrize(
    "line",
    [
        "البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤",  # a label AND the expiry — the expiry is found by no other means
        "الديانة مسلمة",
        NAME,
        "٢٩٥٠٣ ١٤١٢ ٣٤٥٦٧",
    ],
)
def test_a_line_carrying_a_value_is_kept(line):
    assert not is_boilerplate(line)


def test_the_name_field_arrives_clean_even_when_the_crop_caught_the_header():
    """The end-to-end shape of the trade: a generous crop, and a value with nothing extra in it."""
    assert clean_text(f"بطاقة تحقيق الشخصية {NAME}") == NAME
