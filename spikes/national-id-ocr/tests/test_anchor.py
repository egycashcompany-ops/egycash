"""Moving the field boxes onto the text that is actually there."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.anchor import anchor, snap, structural  # noqa: E402
from nidocr.layout import FieldBox  # noqa: E402

SIZE = (1000, 600)

#: An invented name in the shape a real card prints: a given name alone on the first line, then the
#: father/grandfather/family chain on the second.
GIVEN_NAME = "سلمى"
FAMILY_CHAIN = "إبراهيم عبد الرحمن السيد"


def _line(left, top, right, bottom, text="نص", score=0.9):
    return ([[left, top], [right, top], [right, bottom], [left, bottom]], text, score)


# ── Snapping ──


def test_a_box_is_pulled_onto_a_line_that_drifted_out_of_it():
    """The whole point: a few percent of rectification error must stop costing a field."""
    box = FieldBox("fullNameAr", x=0.30, y=0.20, w=0.50, h=0.10)
    lines = [_line(340, 156, 780, 204)]  # y 0.26-0.34 of 600

    fitted, sources = snap((box,), lines, SIZE)
    assert sources["fullNameAr"] == "snapped"
    assert fitted["fullNameAr"].y > box.y, "the box did not follow the text down"
    assert fitted["fullNameAr"].y < 0.27, "the box should start at the text, with a little padding"


def test_a_snap_that_would_swallow_the_next_field_is_abandoned():
    """Recognizing two fields as one produces a confident string that is wrong."""
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
    """Identified by shape, not position, which is what makes an unfamiliar card design readable.
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
    """The issue date sits beside the expiry and must not be mistaken for it."""
    lines = [
        _line(100, 100, 400, 150, "٢٠١٥/٠٧"),  # issue: year and month only
        _line(100, 300, 500, 350, "البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤"),
    ]
    found = structural(lines, SIZE, wanted={"nationalIdExpiry"})
    assert "nationalIdExpiry" in found
    assert 0.45 < found["nationalIdExpiry"].y < 0.55


def test_two_candidate_lines_produce_no_assignment():
    """Ambiguity is refused rather than broken by position."""
    lines = [
        _line(100, 100, 900, 160, "٢٩٥٠٣١٤١٢٣٤٥٦٧"),
        _line(100, 400, 900, 460, "٢٩٢٠٨١٥١٢٠٣٤٥٧"),
    ]
    assert structural(lines, SIZE, wanted={"nationalId"}) == {}


def test_only_requested_fields_are_assigned():
    lines = [_line(100, 500, 900, 560, "٢٩٥٠٣١٤١٢٣٤٥٦٧")]
    assert structural(lines, SIZE, wanted={"address"}) == {}


def test_structural_assignment_overrides_a_snapped_box():
    """Snapping still assumes the nominal box was roughly right; structure does not."""
    box = FieldBox("nationalId", x=0.05, y=0.05, w=0.30, h=0.08, kind="digits")
    lines = [_line(100, 480, 900, 540, "٢٩٥٠٣ ١٤١٢ ٣٤٥٦٧")]

    anchoring = anchor((box,), lines, SIZE)
    assert anchoring.sources["nationalId"] == "structural"
    assert anchoring.boxes["nationalId"].y > 0.7, "it followed the digits, not the profile"


# ── The regression that reached production ──


def test_a_tall_box_does_not_reach_a_line_beyond_itself():
    """The exact misread reported from the deployed service."""
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
    """The tightened rule must not stop anchoring doing its job."""
    text = _line(300, 200, 700, 250)  # y 0.333-0.417
    drifted = FieldBox("occupation", x=0.28, y=0.30, w=0.45, h=0.07)  # slipped up by ~half a line

    fitted, sources = snap((drifted,), [text], SIZE)
    assert sources["occupation"] == "snapped"
    assert abs(fitted["occupation"].y - 200 / 600) < 0.03, "the box did not follow its own line"


def test_the_sex_religion_marital_row_is_found_by_its_words_not_its_position():
    """The back's layout is variable-height, so fixed geometry cannot address it."""
    lines = [
        _line(100, 60, 900, 110, "٢٠١٥/٠٧    ٢٩٢٠٨١٥١٢٠٣٤٥٧"),
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


def test_snapping_never_narrows_a_box_onto_what_detection_happened_to_find():
    """The failure that outlived two rounds of fixing the name, and the reason it survived them."""
    box = FieldBox("fullNameAr", x=0.36, y=0.18, w=0.61, h=0.28)
    # Detection found only the right-hand part of the line; the final word was missed.
    found = _line(600, 200, 950, 250, "إبراهيم عبد الرحمن")

    fitted, sources = snap((box,), [found], SIZE)
    got = fitted["fullNameAr"]

    assert sources["fullNameAr"] == "snapped"
    assert got.x <= box.x, "the crop was trimmed to the text detection happened to find"
    assert got.x + got.w >= box.x + box.w
    # ...while still following the text vertically, which is what anchoring is for.
    assert got.y > box.y, "the crop did not follow its line down"
    assert got.y + got.h < 0.50


def test_two_separate_fields_on_one_row_are_not_merged_into_each_other():
    """The merge is bounded by the gap. A word gap joins; the gap between two fields does not."""
    lines = [_line(120, 200, 300, 250, "٢٠١٥/٠٧"), _line(700, 200, 950, 250, "٢٩٥٠٣١٤١٢٣٤٥٦٧")]
    box = FieldBox("nationalIdExpiry", x=0.08, y=0.30, w=0.25, h=0.10, kind="digits")

    fitted, _ = snap((box,), lines, SIZE)
    assert fitted["nationalIdExpiry"].x + fitted["nationalIdExpiry"].w < 0.6, (
        "the expiry crop swallowed the national ID printed at the other end of the row"
    )


def test_the_cards_own_printed_words_cannot_pull_a_box_onto_them():
    """'بطاقة تحقيق الشخصية' is printed above the name on every card and belongs to nobody."""
    box = FieldBox("fullNameAr", x=0.36, y=0.18, w=0.61, h=0.28)  # spans the header and the name
    header = _line(300, 100, 950, 150, "بطاقة تحقيق الشخصية")
    name = _line(300, 200, 950, 250, FAMILY_CHAIN)

    fitted, _ = snap((box,), [header, name], SIZE)
    assert fitted["fullNameAr"].y > 150 / 600, "the box was still pulled up onto the printed header"


def test_a_label_that_precedes_its_value_is_not_discarded():
    """The distinction the boilerplate rule turns on, and the one it would be easy to get wrong."""
    lines = [_line(100, 300, 700, 350, "البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤")]
    assert "nationalIdExpiry" in structural(lines, SIZE, wanted={"nationalIdExpiry"})


def test_a_vocabulary_row_appearing_twice_is_refused():
    """Same uniqueness rule as everywhere else, two candidates means no evidence, not a coin flip."""
    lines = [
        _line(100, 100, 900, 150, "أنثى مسلمة متزوجة"),
        _line(100, 300, 900, 350, "مسلمة"),
    ]
    assert structural(lines, SIZE, wanted={"religion"}) == {}


def test_the_printed_photo_beside_the_name_does_not_widen_the_name_box():
    """Detection reads text on the photo ('photo' on the fixtures, a pattern on real stock)."""
    box = FieldBox("fullNameAr", x=0.34, y=0.20, w=0.62, h=0.20)
    name = _line(620, 150, 950, 190, FAMILY_CHAIN)
    photo = _line(90, 220, 180, 250, "PHOTO")  # centre x 0.135, inside the old 35% slack

    fitted, sources = snap((box,), [name, photo], SIZE)
    assert sources["fullNameAr"] == "snapped"
    # Normal padding moves the edge a little; reaching the photo (x < 0.18) is the failure.
    assert fitted["fullNameAr"].x > 0.25, "the name box grew across the photo"
