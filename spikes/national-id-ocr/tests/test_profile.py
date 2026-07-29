"""Invariants every layout profile has to hold, checked against the shipped Egyptian one.

The built-in geometry was wrong on a real card in ways that were invisible until someone scanned
one: boxes sat where the card is blank, the address box's top edge reached into the name, and the
expiry box extended over the 2D barcode on the back. None of those are detectable by reading the
numbers — but each one violates a property that is cheap to state and cheap to check.

So the properties are checked here rather than trusted. A future profile — a new card generation,
a different country — gets the same guarantees for free by being run through this file.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr import layout  # noqa: E402

PROFILES = sorted((ROOT / "profiles").glob("*.json"))


@pytest.fixture(params=[p.name for p in PROFILES] or ["<none>"])
def profile(request):
    if not PROFILES:
        pytest.skip("no profiles shipped")
    path = ROOT / "profiles" / request.param
    # load_profile mutates module globals; restore them so test order cannot matter.
    saved = (layout.FRONT_FIELDS, layout.BACK_FIELDS, layout.ALL_FIELD_NAMES,
             layout.CANONICAL_SIZE, layout._ACTIVE_PROFILE)
    layout.load_profile(str(path))
    yield path
    (layout.FRONT_FIELDS, layout.BACK_FIELDS, layout.ALL_FIELD_NAMES,
     layout.CANONICAL_SIZE, layout._ACTIVE_PROFILE) = saved


@pytest.fixture
def restore_layout():
    """Save and restore the layout globals for a test that loads a profile by hand.

    `load_profile` mutates module state, and `test_profile.py` runs before several other files
    alphabetically — so a test that loads a profile and does not put it back would hand the rest of
    the suite geometry it never asked for, and the resulting failures would point anywhere but here.
    """
    saved = (layout.FRONT_FIELDS, layout.BACK_FIELDS, layout.ALL_FIELD_NAMES,
             layout.CANONICAL_SIZE, layout._ACTIVE_PROFILE)
    yield
    (layout.FRONT_FIELDS, layout.BACK_FIELDS, layout.ALL_FIELD_NAMES,
     layout.CANONICAL_SIZE, layout._ACTIVE_PROFILE) = saved


def _overlap(a, b) -> bool:
    return (a.x < b.x + b.w and b.x < a.x + a.w) and (a.y < b.y + b.h and b.y < a.y + a.h)


def test_boxes_stay_inside_the_card(profile):
    """A box running past the edge is silently clamped by `to_pixels`, so it reads a narrower
    region than the profile claims — the kind of error that looks like poor accuracy."""
    for box in (*layout.FRONT_FIELDS, *layout.BACK_FIELDS):
        assert 0.0 <= box.x and box.x + box.w <= 1.0, f"{box.name} runs off horizontally"
        assert 0.0 <= box.y and box.y + box.h <= 1.0, f"{box.name} runs off vertically"


def test_no_two_boxes_on_a_side_overlap(profile):
    """Overlapping boxes make one field capture another's text.

    Note this would NOT have caught the original defect: the default boxes did not overlap each
    other, they were simply positioned wrong relative to a real card's print. This guards the
    class of mistake made while writing this profile instead — the first draft had religion at
    x 0.48-0.67 and maritalStatus at 0.34-0.51, and on an RTL card those two sit side by side
    with only a few percent between them.
    """
    for side, boxes in (("front", layout.FRONT_FIELDS), ("back", layout.BACK_FIELDS)):
        for index, first in enumerate(boxes):
            for second in boxes[index + 1 :]:
                assert not _overlap(first, second), f"{side}: {first.name} overlaps {second.name}"


def test_the_back_expiry_box_clears_the_barcode(profile):
    """The bottom of the Egyptian card's back is a 2D barcode. Recognition run over it returns
    confident nonsense rather than nothing, so the failure would read as a bad OCR, not a bad box.
    Barcode decoding is explicitly out of scope; staying off it is the whole handling."""
    expiry = next((b for b in layout.BACK_FIELDS if b.name == "nationalIdExpiry"), None)
    if expiry is None:
        pytest.skip("profile does not extract the expiry")
    assert expiry.y + expiry.h <= 0.58, "expiry box extends into the barcode band"


def test_digit_fields_are_declared_as_digits(profile):
    """`kind` drives both the binarization and the post-processing fold from Arabic-Indic
    numerals. A digit field typed as text keeps its ٠١٢ and fails `parseNationalId` downstream."""
    by_name = {b.name: b for b in (*layout.FRONT_FIELDS, *layout.BACK_FIELDS)}
    for name in ("nationalId", "nationalIdExpiry"):
        if name in by_name:
            assert by_name[name].kind == "digits", f"{name} must be kind='digits'"


def test_profile_is_valid_json_with_the_expected_shape(profile):
    data = json.loads(profile.read_text(encoding="utf-8"))
    assert set(data) >= {"front", "back"}
    assert len(data["canonicalSize"]) == 2


# ── The shipped default ──


def test_the_image_default_profile_exists_and_loads(restore_layout):
    """The geometry the Dockerfile names must be real, and must parse.

    This exists because the opposite went unnoticed for a whole deployment cycle. `egypt-nid.json`
    was measured from a real card specifically to stop the name box catching the card's header and
    the address box catching the name — then `OCR_LAYOUT_PROFILE` was documented as optional, left
    unset, and every deployment ran the synthetic geometry instead. Nothing failed; the fields just
    came back wrong, and the recognizer got the blame.

    `load_profile` raises rather than falling back, so a broken path fails the container at start —
    loud, but only once it is deployed. Asserting it here moves that discovery into CI.
    """
    import re

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    declared = re.search(r"^ENV\s+OCR_LAYOUT_PROFILE=(\S+)", dockerfile, re.MULTILINE)
    assert declared, "the image must declare a default geometry profile"

    # /app is the image's WORKDIR and mirrors the repository root.
    path = ROOT / declared.group(1).replace("/app/", "")
    assert path.is_file(), f"Dockerfile points OCR_LAYOUT_PROFILE at a missing file: {path}"

    layout.load_profile(str(path))
    assert layout.active_profile_name() == path.name
    assert {box.name for box in layout.FRONT_FIELDS} == {"fullNameAr", "address", "nationalId"}


def test_the_shipped_profile_covers_the_whole_printed_text_column(restore_layout):
    """The front text boxes are deliberately generous, and this pins that decision down.

    It replaces a guard that required the name box to start below the card's printed header. That
    guard was answering the right complaint — 'بطاقة تحقيق الشخصية' came back glued to a name — with
    the wrong instrument. A box drawn tightly enough to miss the header is drawn tightly around one
    card's name, and the next card's name wrapped differently: its given name sat above the box's
    top edge and the last word of its family chain ran past the box's left edge, so the field came
    back missing a word at each end. Nothing downstream could tell, because every word it did return
    was correct.

    The two errors are not worth the same. Text the box lets in is removable — everything printed
    around these fields is the card's own furniture, identical on every card, and `boilerplate`
    strips it by phrase. Text the box cuts off is gone. So the boxes span the text column and the
    header is excluded by what it says rather than by where it sits.

    What still has to hold is that the boxes do not reach each OTHER: the name and the address are
    both somebody's data, and neither can be removed from the other by vocabulary.
    """
    layout.load_profile(str(ROOT / "profiles" / "egypt-nid.json"))
    boxes = {box.name: box for box in layout.FRONT_FIELDS}
    name, address, national_id = boxes["fullNameAr"], boxes["address"], boxes["nationalId"]

    # Every field is right-aligned to the card's print margin, and reaches the left margin the
    # national-ID line establishes — a name line cannot start further left than the card prints.
    assert name.x <= national_id.x, "the name box stops short of the card's left print margin"
    assert name.x + name.w >= 0.95, "the name box stops short of the right print margin"
    assert address.x <= national_id.x

    # Two lines of print, comfortably. A card whose name wraps onto a second line at a different
    # height must still fall inside.
    assert name.h >= 0.24, "the name box cannot hold two lines of print with any room to spare"

    # ...but not into the next field. This is the boundary that vocabulary cannot rescue.
    assert name.y + name.h <= address.y, "the name box reaches into the address"
    assert address.y + address.h <= national_id.y, "the address box reaches into the number"


def test_the_shipped_front_geometry_reads_a_two_line_name_end_to_end(restore_layout):
    """The reported failure, end to end, against the geometry the container actually ships.

    A name printed on two lines, the second detected as two fragments — the shape that produced
    'إبراهيم عبد الرحمن' from a card printing 'سلمى' above 'إبراهيم عبد الرحمن السيد'. A word
    missing from each end, every word returned correct, and nothing anywhere reporting a problem.

    Asserted against the shipped profile rather than an invented box because the geometry is the
    thing that was wrong: unit tests of `anchor` passed throughout, on boxes that were not the ones
    in the image.
    """
    from nidocr.anchor import anchor  # noqa: PLC0415 — after the profile is loaded

    layout.load_profile(str(ROOT / "profiles" / "egypt-nid.json"))
    size = layout.CANONICAL_SIZE
    width, height = size

    def line(x0, y0, x1, y1, text):
        box = [[x0 * width, y0 * height], [x1 * width, y0 * height],
               [x1 * width, y1 * height], [x0 * width, y1 * height]]
        return (box, text, 0.95)

    lines = [
        line(0.40, 0.09, 0.95, 0.155, "بطاقة تحقيق الشخصية"),  # the card's own words
        line(0.80, 0.20, 0.95, 0.265, "سلمى"),                  # given name, short, right-aligned
        line(0.52, 0.29, 0.95, 0.355, "إبراهيم عبد الرحمن"),    # family chain, detected as
        line(0.37, 0.29, 0.50, 0.355, "السيد"),                 # ...two fragments
        line(0.42, 0.50, 0.95, 0.565, "١٢ ش الثورة - الدقهلية"),
        line(0.38, 0.78, 0.95, 0.845, "٢٩٥٠٣ ١٤١٢ ٣٤٥٦٧"),
    ]

    boxes = anchor(layout.FRONT_FIELDS, lines, size).boxes
    name = boxes["fullNameAr"]

    assert name.y < 0.20, "the crop starts below the given name — its first line is cut off"
    assert name.x < 0.37, "the crop starts right of the family chain — its last word is cut off"
    assert name.x + name.w > 0.94, "the crop stops short of where the name begins"
    assert name.y + name.h < 0.50, "the crop reaches down into the address"
