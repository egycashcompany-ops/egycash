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


def test_the_shipped_profile_puts_the_name_below_the_card_header(restore_layout):
    """A regression guard on the specific misread the user reported.

    The card prints 'بطاقة تحقيق الشخصية' across the top. A name box whose top edge reaches into
    that band returns the header glued to the name — which is exactly what came back — and the
    English transliteration then inherits it. Keeping the name box below the header band is the
    property that stops it.
    """
    layout.load_profile(str(ROOT / "profiles" / "egypt-nid.json"))
    boxes = {box.name: box for box in layout.FRONT_FIELDS}

    assert boxes["fullNameAr"].y > 0.20, "the name box reaches into the card's printed header"
    assert boxes["address"].y >= boxes["fullNameAr"].y + boxes["fullNameAr"].h * 0.9, (
        "the address box overlaps the name lines"
    )
