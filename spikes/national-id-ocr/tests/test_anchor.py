"""Moving the field boxes onto the text that is actually there.

A box that misses its line returns an empty string, and in an accuracy table an empty string is
indistinguishable from "the model cannot read Arabic" — two problems with completely different
fixes. Anchoring exists so that small geometric error stops producing that symptom, and so that a
card design the profile was never calibrated against can still give up its most important field.

The tests are about the boundary. Snapping must correct drift without swallowing the neighbouring
field, and structural assignment must fire only when the evidence is unambiguous.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.anchor import anchor, snap, structural  # noqa: E402
from nidocr.layout import FieldBox  # noqa: E402

SIZE = (1000, 600)

#: An invented name in the shape a real card prints: a given name alone on the first line, then the
#: father/grandfather/family chain on the second. The shape is what these tests are about; the words
#: belong to nobody, which is the only acceptable way to keep card text in a repository.
GIVEN_NAME = "سلمى"
FAMILY_CHAIN = "إبراهيم عبد الرحمن السيد"


def _line(left, top, right, bottom, text="نص", score=0.9):
    return ([[left, top], [right, top], [right, bottom], [left, bottom]], text, score)


# ── Snapping ──


def test_a_box_is_pulled_onto_a_line_that_drifted_out_of_it():
    """The whole point: a few percent of rectification error must stop costing a field.

    The nominal box sits at y 0.20-0.30; the text really sits at y 0.26-0.34, overlapping but
    offset. Cropping the nominal box would shave the line in half.
    """
    box = FieldBox("fullNameAr", x=0.30, y=0.20, w=0.50, h=0.10)
    lines = [_line(340, 156, 780, 204)]  # y 0.26-0.34 of 600

    fitted, sources = snap((box,), lines, SIZE)
    assert sources["fullNameAr"] == "snapped"
    assert fitted["fullNameAr"].y > box.y, "the box did not follow the text down"
    assert fitted["fullNameAr"].y < 0.27, "the box should start at the text, with a little padding"


def test_a_snap_that_would_swallow_the_next_field_is_abandoned():
    """Recognizing two fields as one produces a confident string that is wrong.

    No confidence score reflects that kind of wrong, so the growth guard is the only thing standing
    between a merged crop and a name field containing half an address.
    """
    box = FieldBox("fullNameAr", x=0.30, y=0.20, w=0.50, h=0.08)
    lines = [_line(300, 120, 800, 168), _line(300, 300, 800, 400)]  # second is far below

    _, sources = snap((box,), lines, SIZE)
    assert sources["fullNameAr"] in {"snapped", "nominal"}

    # Two lines close enough to both fall inside the expanded box, whose union is far too tall.
    tall = FieldBox("address", x=0.30, y=0.20, w=0.50, h=0.05)
    crowded = [_line(300, 118, 800, 130), _line(300, 190, 800, 260)]
    fitted, sources = snap((tall,), crowded, SIZE)
    if sources["address"] == "snapped":
        assert fitted["address"].h <= tall.h * 2.5


def test_a_box_with_no_text_near_it_keeps_its_nominal_position():
    """Absence of evidence is not evidence to move. A missing line leaves the prior alone."""
    box = FieldBox("occupation", x=0.10, y=0.10, w=0.40, h=0.08)
    fitted, sources = snap((box,), [_line(700, 500, 900, 550)], SIZE)
    assert sources["occupation"] == "nominal"
    assert fitted["occupation"] == box


def test_no_detections_at_all_leaves_every_box_untouched():
    boxes = (FieldBox("a", 0.1, 0.1, 0.2, 0.1), FieldBox("b", 0.4, 0.4, 0.2, 0.1))
    anchoring = anchor(boxes, [], SIZE)
    assert anchoring.boxes == {box.name: box for box in boxes}
    assert set(anchoring.sources.values()) == {"nominal"}


# ── Structural assignment ──


def test_a_fourteen_digit_line_is_the_national_id_wherever_it_sits():
    """Identified by shape, not position — which is what makes an unfamiliar card design readable.

    Egypt has issued more than one layout, and cards from 2007 are still in circulation. A profile
    calibrated on current stock lands on blank laminate on those, but a line of fourteen digits is
    the national ID on any of them.
    """
    lines = [
        _line(100, 500, 900, 560, "٢٩٥٠٣ ١٤١٢ ٣٤٥٦٧"),
        _line(100, 100, 900, 160, "محمد احمد على"),
    ]
    found = structural(lines, SIZE, wanted={"nationalId"})
    assert "nationalId" in found
    assert found["nationalId"].kind == "digits"
    assert 0.80 < found["nationalId"].y < 0.90, "it should land on the digits, not the name"


def test_a_full_date_is_the_expiry_and_a_year_month_is_not():
    """The issue date sits beside the expiry and must not be mistaken for it.

    They are told apart by shape alone — the expiry carries a day, the issue date does not — so
    nothing depends on correctly recognizing the Arabic label printed next to either.
    """
    lines = [
        _line(100, 100, 400, 150, "٢٠١٥/٠٧"),  # issue: year and month only
        _line(100, 300, 500, 350, "البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤"),
    ]
    found = structural(lines, SIZE, wanted={"nationalIdExpiry"})
    assert "nationalIdExpiry" in found
    assert 0.45 < found["nationalIdExpiry"].y < 0.55


def test_two_candidate_lines_produce_no_assignment():
    """Ambiguity is refused rather than broken by position.

    Choosing between two fourteen-digit lines by where they sit would reintroduce exactly the
    geometric assumption structural assignment exists to avoid.
    """
    lines = [
        _line(100, 100, 900, 160, "٢٩٥٠٣١٤١٢٣٤٥٦٧"),
        _line(100, 400, 900, 460, "٢٨٧٠٩٠١١٢٠٢٤٠٨"),
    ]
    assert structural(lines, SIZE, wanted={"nationalId"}) == {}


def test_only_requested_fields_are_assigned():
    lines = [_line(100, 500, 900, 560, "٢٩٥٠٣١٤١٢٣٤٥٦٧")]
    assert structural(lines, SIZE, wanted={"address"}) == {}


def test_structural_assignment_overrides_a_snapped_box():
    """Snapping still assumes the nominal box was roughly right; structure does not.

    Where the two disagree, the case is precisely the one where the profile is most wrong — so the
    layout-independent answer has to win.
    """
    box = FieldBox("nationalId", x=0.05, y=0.05, w=0.30, h=0.08, kind="digits")
    lines = [_line(100, 480, 900, 540, "٢٩٥٠٣ ١٤١٢ ٣٤٥٦٧")]

    anchoring = anchor((box,), lines, SIZE)
    assert anchoring.sources["nationalId"] == "structural"
    assert anchoring.boxes["nationalId"].y > 0.7, "it followed the digits, not the profile"


# ── The regression that reached production ──


def test_a_tall_box_does_not_reach_a_line_beyond_itself():
    """The exact misread reported from the deployed service.

    The card prints 'بطاقة تحقيق الشخصية' above the name and the address below it. The name box
    spans two lines — 0.20 of the card's height — and the original selection rule gave it a margin
    of 35% OF ITS OWN HEIGHT, or 0.07, which on this card is one whole line of print. So the box
    reached a full line up and a full line down, unioned all three, and the recognizer returned the
    header, the name and the address as one field. The address box did the same thing one line
    lower, which is why the address came back beginning with the name.

    Anchoring is supposed to correct drift of a few percent. Tying its reach to a line of text
    rather than to the box keeps a tall field from being able to travel to its neighbours at all.
    """
    header = _line(300, 90, 700, 145, "بطاقة تحقيق الشخصية")
    name_one = _line(300, 160, 700, 215, GIVEN_NAME)
    name_two = _line(300, 225, 700, 280, FAMILY_CHAIN)
    address = _line(300, 300, 700, 355, "برج الشروق - ش أحمد ماهر")

    # Nominal box covering the two name lines: y 0.26-0.46 of 600px = 156-276.
    name_box = FieldBox("fullNameAr", x=0.28, y=0.26, w=0.45, h=0.20)

    fitted, sources = snap((name_box,), [header, name_one, name_two, address], SIZE)
    got = fitted["fullNameAr"]

    assert sources["fullNameAr"] == "snapped"
    assert got.y > 145 / 600, "the crop still reaches up into the card's printed header"
    assert got.y + got.h < 300 / 600, "the crop still reaches down into the address"


def test_drift_within_a_line_is_still_corrected():
    """The tightened rule must not stop anchoring doing its job.

    Half a line of slack is the point: a box that slipped less than that still belongs to its own
    text and should follow it. Only a box that slipped further is pointing at a neighbour.
    """
    text = _line(300, 200, 700, 250)  # y 0.333-0.417
    drifted = FieldBox("occupation", x=0.28, y=0.30, w=0.45, h=0.07)  # slipped up by ~half a line

    fitted, sources = snap((drifted,), [text], SIZE)
    assert sources["occupation"] == "snapped"
    assert abs(fitted["occupation"].y - 200 / 600) < 0.03, "the box did not follow its own line"


def test_the_sex_religion_marital_row_is_found_by_its_words_not_its_position():
    """The back's layout is variable-height, so fixed geometry cannot address it.

    Occupation is one line on some cards and two on others — Egyptian job titles run long
    ('معيدة بقسم الصحة العامة وطب المجتمع' over 'كلية الطب - جامعة المنصورة'). Everything printed
    below it therefore shifts by a line, and the profile, calibrated on a one-line card, put the
    religion box straight onto the occupation's second line. That is how 'المنصور' — half of
    'جامعة المنصورة' — arrived in production as somebody's religion.

    Religion and marital status come from vocabularies of four and eight words, so they can be
    found the same way the national ID and the expiry are: by content. Both share one printed row,
    and both anchor to it — `clean_religion` and `clean_marital_status` then pull the right word
    out of the row by vocabulary, which they already did.
    """
    lines = [
        _line(100, 60, 900, 110, "٢٠١٥/٠٧    ٢٨٧٠٩٠١١٢٠٢٤٠٨"),
        _line(100, 130, 900, 180, "معيدة بقسم الصحة العامة وطب المجتمع"),
        _line(100, 190, 900, 240, "كلية الطب - جامعة المنصورة"),  # where the old box pointed
        _line(300, 260, 700, 310, "أنثى مسلمة متزوجة"),
        _line(100, 380, 700, 430, "البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤"),
    ]
    found = structural(lines, SIZE, wanted={"religion", "maritalStatus", "nationalIdExpiry"})

    assert set(found) == {"religion", "maritalStatus", "nationalIdExpiry"}
    # Both land on the shared row, well clear of the occupation's second line at y 0.317-0.40.
    for name in ("religion", "maritalStatus"):
        assert 0.40 < found[name].y < 0.45, f"{name} did not land on the sex/religion/marital row"
        assert found[name].kind == "text", "these are words, not digits"
    assert found["nationalIdExpiry"].y > 0.60


# ── The name that kept coming back incomplete ──


def test_a_word_at_the_far_end_of_a_line_is_not_lost():
    """A name's last word arrives as its own detection, and its centre is nowhere near the line's.

    Detection returns text REGIONS, not lines, and how a line breaks into regions depends on how
    wide its word gaps happen to be. When the family chain came back as two regions, the left one
    held a single word whose centre sat outside the name box entirely — so the box took the right
    region, the crop stopped where that region stopped, and the name lost its final word. Every
    word the pipeline returned was correct, which is exactly why nothing flagged it.

    Merging the fragments back into the line they were printed as is the fix, and it has to happen
    before anything asks where a line's centre is.
    """
    box = FieldBox("fullNameAr", x=0.36, y=0.18, w=0.61, h=0.28)
    # One printed line, detected as two regions with an ordinary word gap between them.
    right = _line(560, 200, 950, 250, "إبراهيم عبد الرحمن")
    left = _line(300, 200, 540, 250, "السيد")

    fitted, sources = snap((box,), [right, left], SIZE)
    got = fitted["fullNameAr"]

    assert sources["fullNameAr"] == "snapped"
    assert got.x < 0.31, "the crop stops short of the word at the far end of the line"
    assert got.x + got.w > 0.94, "the crop no longer reaches the start of the line"


def test_two_separate_fields_on_one_row_are_not_merged_into_each_other():
    """The merge is bounded by the gap. A word gap joins; the gap between two fields does not.

    The back prints the issue date and the national ID on one row with a wide space between them,
    and they are two different fields. Merging on proximity alone would make every row a single
    region and hand each box the whole row.
    """
    lines = [_line(120, 200, 300, 250, "٢٠١٥/٠٧"), _line(700, 200, 950, 250, "٢٩٥٠٣١٤١٢٣٤٥٦٧")]
    box = FieldBox("nationalIdExpiry", x=0.08, y=0.30, w=0.25, h=0.10, kind="digits")

    fitted, _ = snap((box,), lines, SIZE)
    assert fitted["nationalIdExpiry"].x + fitted["nationalIdExpiry"].w < 0.6, (
        "the expiry crop swallowed the national ID printed at the other end of the row"
    )


def test_the_cards_own_printed_words_cannot_pull_a_box_onto_them():
    """'بطاقة تحقيق الشخصية' is printed above the name on every card and belongs to nobody.

    A name box tight enough to exclude it is also tight enough to clip the first line of a name that
    wraps differently, and clipping is the worse failure: a header glued to a name is removable
    because the phrase is identical on every card, while a name line that was never cropped in
    cannot be recovered anywhere. So the box is allowed to be generous and the header stops counting
    as text.
    """
    box = FieldBox("fullNameAr", x=0.36, y=0.18, w=0.61, h=0.28)  # spans the header AND the name
    header = _line(300, 100, 950, 150, "بطاقة تحقيق الشخصية")
    name = _line(300, 200, 950, 250, FAMILY_CHAIN)

    fitted, _ = snap((box,), [header, name], SIZE)
    assert fitted["fullNameAr"].y > 150 / 600, "the box was still pulled up onto the printed header"


def test_a_label_that_precedes_its_value_is_not_discarded():
    """The distinction the boilerplate rule turns on, and the one it would be easy to get wrong.

    'البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤' is a printed label AND the expiry date. Dropping the line for
    carrying card furniture would take the date with it — and the expiry is found by nothing else.
    """
    lines = [_line(100, 300, 700, 350, "البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤")]
    assert "nationalIdExpiry" in structural(lines, SIZE, wanted={"nationalIdExpiry"})


def test_a_vocabulary_row_appearing_twice_is_refused():
    """Same uniqueness rule as everywhere else — two candidates means no evidence, not a coin flip."""
    lines = [
        _line(100, 100, 900, 150, "أنثى مسلمة متزوجة"),
        _line(100, 300, 900, 350, "مسلمة"),
    ]
    assert structural(lines, SIZE, wanted={"religion"}) == {}
