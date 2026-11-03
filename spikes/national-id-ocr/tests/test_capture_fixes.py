"""The fixes for the October stress set: dates beside the number, impossible ages, the printed
birth date, which way up a back is, and how the flat card is shown."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.ensemble import Candidate  # noqa: E402
from nidocr.extract import _check_birth, _laid_turn  # noqa: E402
from nidocr.nid import is_structurally_valid, repair  # noqa: E402
from nidocr.orientation import barcode_turn, turn  # noqa: E402
from nidocr.rows import _birth_date, _id_field, _is_date, _undated  # noqa: E402

TODAY = dt.date(2026, 10, 14)
#: A made-up number: born 2003-07-25 in Cairo (01).
NUMBER = "30307250100015"


def test_a_century_digit_misread_makes_an_impossible_holder():
    assert is_structurally_valid(NUMBER, today=TODAY)
    # 1903: a holder 123 years old. It used to pass as a valid number and be handed back as read.
    assert not is_structurally_valid("2" + NUMBER[1:], today=TODAY)
    # Born last year: nobody that young has a card.
    assert not is_structurally_valid("32501010100015", today=TODAY)


def test_a_slash_in_a_date_is_not_a_digit_of_the_number():
    # The birth date printed beside the number, read together with it.
    assert repair("٢٠٠٣/٠٧/٢٥ ٣٠٣٠٧٢٥٠١٠٠٠١٥", today=TODAY).value == NUMBER
    # A date alone is never made into a number.
    assert not repair("2003/07/25", today=TODAY).valid


def test_a_date_with_its_slashes_read_as_ones_is_still_a_date():
    assert _is_date("2003107125")  # 2003/07/25
    assert _is_date("2019112")  # 2019/12
    assert not _is_date(NUMBER)
    assert not _is_date("0100015")


def _line(text: str, left: float) -> dict:
    return {"text": text, "score": 0.9, "box": (left, 100.0, left + 200.0, 130.0)}


def test_the_printed_birth_date_is_found_however_its_slashes_were_read():
    for printed in ("٢٠٠٣/٠٧/٢٥", "2003107125", "20030725"):
        rows = [[_line(printed, 10.0), _line("٣٠٣٠٧٢٥٠١٠٠٠١٥", 300.0)]]
        assert _birth_date(rows, 0) == "20030725", printed


def test_a_number_that_agrees_with_the_printed_birth_date_is_preferred():
    wrong = "30307260100015"  # 26th, not 25th: valid, but not this card's
    data = {"value": wrong, "confidence": "high", "valid": True, "score": 0.95}
    candidates = [Candidate("grey", wrong, 0.95), Candidate("thick", NUMBER, 0.9)]
    _check_birth(data, "20030725", candidates)
    assert data["value"] == NUMBER and data["birthDateAgrees"]
    assert data["confidence"] != "high"  # chosen by a cross-check, not read outright


def test_a_number_that_contradicts_the_printed_birth_date_is_not_trusted():
    wrong = "30307260100015"
    data = {"value": wrong, "confidence": "high", "valid": True, "score": 0.95}
    _check_birth(data, "20030725", [Candidate("grey", wrong, 0.95)])
    assert data["birthDateMismatch"] and data["confidence"] == "medium"


def test_when_the_printed_date_is_misread_too_the_number_nearest_to_it_wins():
    """As on a live phone photo (numbers made up): the card says 2004/11/15 and 30411150204337.
    The date read 2004/11/10 and the chosen number 30311150204337; the right number was among the
    reads but agreed with neither exactly. It is one blur-confusable digit (٥/٠) from the printed
    date, the other two (٣/٤ and ٥/٠), so it wins — never above medium."""
    right, wrong = "30411150204337", "30311150204337"
    data = {"value": wrong, "confidence": "medium", "valid": True, "score": 0.89}
    candidates = [Candidate("grey", wrong, 0.89), Candidate("thick", right, 0.9), Candidate("clahe", "20411100204330", 0.91)]
    _check_birth(data, "20041110", candidates)
    assert data["value"] == right
    assert data["confidence"] == "medium"


def test_a_nearer_read_must_be_strictly_nearer_and_differ_only_by_confusable_digits():
    wrong = "30307260100015"
    # The only read is the one already chosen: nothing nearer, so the mismatch stands.
    data = {"value": wrong, "confidence": "high", "valid": True, "score": 0.95}
    _check_birth(data, "20030725", [Candidate("grey", wrong, 0.95)])
    assert data["value"] == wrong and data["birthDateMismatch"]
    # A read off by a digit no blur makes (٧ for ١) is not "near" at all.
    data = {"value": "30307260100015", "confidence": "high", "valid": True, "score": 0.95}
    _check_birth(data, "20030725", [Candidate("grey", "30307260100015", 0.95), Candidate("x", "30301250100015", 0.9)])
    assert data["value"] == "30307260100015"


def _back(width: int = 600, height: int = 378) -> np.ndarray:
    """A card back: print in its upper half, a dense barcode across its lower part."""
    rng = np.random.default_rng(1)
    card = np.full((height, width, 3), 225, np.uint8)
    for row in range(4):  # print across the card's width, as on the real back
        for left in (40, 330):
            cv2.putText(card, "ABCD 1234", (left, 50 + 40 * row), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (120, 120, 120), 1)
    # PDF417 modules are a couple of pixels across at this size: dense in both directions.
    cells = rng.integers(0, 2, (72, 240)).astype(np.uint8) * 255
    barcode = cv2.resize(cells, (int(width * 0.8), int(height * 0.38)), interpolation=cv2.INTER_NEAREST)
    top, left = int(height * 0.57), int(width * 0.1)
    card[top: top + barcode.shape[0], left: left + barcode.shape[1]] = barcode[..., None]
    return card


def test_the_barcode_says_which_way_up_a_back_is():
    back = _back()
    for applied in (0, 90, 180, 270):
        assert barcode_turn(turn(back, applied)) == (360 - applied) % 360, applied


def test_a_flat_card_is_shown_turned_only_by_what_laying_it_flat_did_not_do():
    # Outline corners TL, TR, BR, BL of the card in the photo.
    upright = np.float32([[0, 0], [100, 0], [100, 60], [0, 60]])
    # The card's top edge running down the photo: it stood on its side, top to the right.
    on_its_side = np.float32([[100, 0], [100, 100], [40, 100], [40, 0]])
    assert _laid_turn(upright) == 0
    assert _laid_turn(on_its_side) == 270


def test_a_date_boxed_together_with_the_first_digits_gives_them_back():
    # The back's issue date and the first five digits came back as one detected line.
    glued = {"text": "٢٠١٩/١٢ ٣٠٣٠٧", "score": 0.9, "box": (0.0, 0.0, 130.0, 20.0)}
    rest = {"text": "٢٥٠١٠٠٠١٥", "score": 0.9, "box": (140.0, 0.0, 240.0, 20.0)}
    raw, _, (left, _, _, _) = _id_field([_undated(glued), rest])
    assert raw == NUMBER
    assert left > 60.0  # the box no longer reaches over the date
    # A date on its own is left as it is, to be kept out of the number as before.
    alone = {"text": "٢٠١٩/١٢", "score": 0.9, "box": (0.0, 0.0, 60.0, 20.0)}
    assert _undated(alone) is alone


# ── Names: where the rows are, and what the detector dropped ─────────────────────────────────────
from nidocr.engine import Recognition  # noqa: E402
from nidocr.extract import _not_a_number  # noqa: E402
from nidocr.rows import RowRead, _front, _recover_name  # noqa: E402


def _row(text: str, top: float, right: float = 900.0, width: float = 300.0, score: float = 0.95) -> list[dict]:
    return [{"text": text, "score": score, "box": (right - width, top, right, top + 40.0)}]


def _front_rows(*, with_given_name: bool) -> list[list[dict]]:
    """A front: title (to y=100), name rows at 0.145 and 0.32 of the way to the number at y=900."""
    rows = [_row("جمهورية مصر العربية", 20), _row("بطاقة تحقيق الشخصية", 60)]
    if with_given_name:
        rows.append(_row("منى", 215, width=120))
    rows.append(_row("محمود سيد علي", 350))
    rows.append(_row("١٥ ش النصر", 560))  # the first address row, at 0.58
    rows.append(_row("المعادي القاهره", 690))
    rows.append(_row("٢٨٥٠٣١٤١٢٠١٢٣٤", 900))
    return rows


def test_a_row_is_the_names_or_the_addresss_by_where_it_sits_not_by_how_many_rows_there_are():
    out = RowRead()
    _front(_front_rows(with_given_name=False), out)
    # With the given name dropped, three rows lie above the number's: the old count-based rule took
    # the first address row for the second half of the name.
    assert out.fields["fullNameAr"][0] == "محمود سيد علي"
    assert out.fields["address"][0].startswith("١٥ ش")


class _Strips:
    """A recognizer that answers each strip by where it was cut from."""

    def __init__(self, answers: dict[str, tuple[str, float]]):
        self.answers = answers
        self.asked: list[tuple[int, int]] = []

    def recognize(self, crop, *, rtl=True):
        self.asked.append(crop.shape[:2])
        text, score = self.answers["given" if len(self.asked) % 2 else "tail"]
        return Recognition(text=text, score=score)


def _card_with_given_name_ink() -> np.ndarray:
    """A blank card with the dropped given name printed where it sits (slot 1, right-aligned).

    A probe reads only a strip's printed ink, so a card with nothing printed in the slot has
    nothing for it to read.
    """
    image = np.full((1000, 1000, 3), 230, np.uint8)
    image[200:240, 780:900] = 30
    return image


def test_a_given_name_the_detector_dropped_is_read_from_where_it_is_printed():
    out = RowRead()
    _front(_front_rows(with_given_name=False), out)
    image = _card_with_given_name_ink()
    # Slot 1 (missing) is probed first and answers; slot 2's end is probed second and finds nothing.
    reader = _Strips({"given": ("منى", 0.8), "tail": ("", 0.0)})
    _recover_name(image, out, reader)
    assert out.fields["fullNameAr"][0] == "منى محمود سيد علي"
    assert out.recovered_name


def test_a_given_name_is_recovered_when_the_title_is_too_blurred_to_read():
    """Seen on a live phone photo: the title read as 'مضوز فضة الجرية' / 'بطاق غفر العحصب', so it was
    cut by its position, and the search for the dropped given name ('عمرو') never ran because it
    measured the name's rows from a title it had only looked for by its words."""
    rows = _front_rows(with_given_name=False)
    rows[0] = _row("مضوز فضة الجرية", 20)
    rows[1] = _row("بطاق غفر العحصب", 60)
    out = RowRead()
    _front(rows, out)
    assert out.fields["fullNameAr"][0] == "محمود سيد علي"
    _recover_name(_card_with_given_name_ink(), out, _Strips({"given": ("منى", 0.8), "tail": ("", 0.0)}))
    assert out.fields["fullNameAr"][0] == "منى محمود سيد علي"
    assert out.recovered_name


def test_a_given_name_one_letter_off_is_taken_when_only_one_name_is_that_close():
    """Seen on a live phone photo: the dropped given name 'عمرو' was read 'صمرو' (0.80) and refused."""
    out = RowRead()
    _front(_front_rows(with_given_name=False), out)
    _recover_name(_card_with_given_name_ink(), out, _Strips({"given": ("صمرو", 0.8), "tail": ("", 0.0)}))
    assert out.fields["fullNameAr"][0] == "عمرو محمود سيد علي"


def test_a_short_or_ambiguous_misread_is_still_left_out():
    """Three letters one off 'محمد' is also 'مجد' on a soft photo; 'منى'-like reads have several names."""
    for read in ("محد", "مني١", "سمرا"):
        out = RowRead()
        _front(_front_rows(with_given_name=False), out)
        _recover_name(_card_with_given_name_ink(), out, _Strips({"given": (read, 0.8), "tail": ("", 0.0)}))
        assert out.fields["fullNameAr"][0] == "محمود سيد علي", read


def test_what_a_probe_reads_beyond_belief_is_left_out():
    out = RowRead()
    _front(_front_rows(with_given_name=False), out)
    image = _card_with_given_name_ink()
    # Not a name the card could carry, and not read confidently: the pattern behind the print.
    _recover_name(image, out, _Strips({"given": ("بببب", 0.75), "tail": ("", 0.0)}))
    assert out.fields["fullNameAr"][0] == "محمود سيد علي"
    assert not out.recovered_name


def test_a_few_digits_of_something_else_are_not_returned_as_the_number():
    assert _not_a_number({"value": "0", "valid": False})
    assert _not_a_number({"value": "1322901800500291278099", "valid": False})  # 22 digits of a smudge
    assert not _not_a_number({"value": "28503141201234", "valid": True})
    # Close to fourteen: left for the reviewer to correct.
    assert not _not_a_number({"value": "2850314120123", "valid": False})


# ── Photos in the wrong box ──────────────────────────────────────────────────────────────────────
from nidocr.extract import _assign_sides  # noqa: E402
from nidocr.orientation import looks_like_back  # noqa: E402


def test_the_back_sent_as_the_front_and_the_front_as_the_back_are_put_right():
    assert _assign_sides({"front": "back", "back": "front"}) == {"front": "back", "back": "front"}
    # One check is enough when the other photo could not be placed.
    assert _assign_sides({"front": "back", "back": None}) == {"front": "back", "back": "front"}
    assert _assign_sides({"front": None, "back": "front"}) == {"front": "back", "back": "front"}


def test_photos_in_the_right_boxes_or_that_cannot_be_placed_are_left_alone():
    assert _assign_sides({"front": "front", "back": "back"}) == {"front": "front", "back": "back"}
    assert _assign_sides({"front": None, "back": None}) == {"front": "front", "back": "back"}
    # Evidence for and against balance: not enough to move anything.
    assert _assign_sides({"front": "back", "back": "back"}) == {"front": "front", "back": "back"}


def test_a_single_photo_is_read_as_the_side_it_shows():
    assert _assign_sides({"front": "back"}) == {"front": "back"}
    assert _assign_sides({"back": "front"}) == {"back": "front"}
    assert _assign_sides({"back": None}) == {"back": "back"}


def test_a_fronts_bottom_strip_is_not_a_barcode_and_a_backs_barcode_is_one():
    assert looks_like_back(_back())
    front = np.full((378, 600, 3), 225, np.uint8)
    rng = np.random.default_rng(2)
    strip = rng.integers(0, 2, (30, 240)).astype(np.uint8) * 255  # a serial strip: the whole width
    front[300:378, :] = cv2.resize(strip, (600, 78), interpolation=cv2.INTER_NEAREST)[..., None]
    assert not looks_like_back(front)


# ── Is it a national ID at all ───────────────────────────────────────────────────────────────────
from nidocr.extract import _back_marker_hits, _card_verdict, _side_verdict, _title_hits  # noqa: E402


def _lines(*texts: str) -> list:
    return [(None, text, 0.9) for text in texts]


def test_the_fronts_title_words_are_counted_however_the_title_was_split_or_misdotted():
    assert _title_hits(_lines("بطاقة تحقيق الشخصية")) == 3
    assert _title_hits(_lines("بطافة", "تحخفيق الشخصية")) >= 2  # dots lost or moved: still enough
    assert _title_hits(_lines("رخصة قيادة درجة ثانية", "وحدة مرور السويس")) == 0


def test_the_backs_words_are_counted():
    assert _back_marker_hits(_lines("ذكر", "مسلم", "متزوج", "البطاقة سارية حتى")) >= 3
    assert _back_marker_hits(_lines("Hany Fadel Mohammed Ahmed", "Egyptian")) == 0


def _front_evidence(**evidence):
    return {"lines": 12, "readable": True, "titleWords": 0, "validNumber": False, "portrait": False, **evidence}


def test_a_front_with_its_title_looks_like_an_id_and_one_without_it_does_not():
    assert _side_verdict("front", _front_evidence(titleWords=3)) == "yes"
    assert _side_verdict("front", _front_evidence(titleWords=1, validNumber=True)) == "yes"
    # A driving licence prints a valid national number and a portrait, and still has no title.
    assert _side_verdict("front", _front_evidence(titleWords=0, validNumber=True, portrait=True)) == "no"
    # Too little read to say either way.
    assert _side_verdict("front", _front_evidence(titleWords=0, lines=3)) == "unsure"
    assert _side_verdict("front", _front_evidence(titleWords=1)) == "unsure"


def test_the_whole_submission_is_not_an_id_when_any_side_clearly_is_not():
    assert _card_verdict({"front": "yes", "back": "yes"}) == "national_id"
    assert _card_verdict({"front": "yes", "back": "no"}) == "not_national_id"
    assert _card_verdict({"front": "yes", "back": "unsure"}) == "unsure"
    assert _card_verdict({"front": "yes"}) == "national_id"


# ── Speed: a rejected back is not re-read ───────────────────────────────────────────────────────
from nidocr.extract import SideResult, _row_field  # noqa: E402
from nidocr.trace import NO_TRACE  # noqa: E402


class _NoReads:
    def recognize(self, crop, *, rtl=True):  # noqa: ARG002
        raise AssertionError("the number was re-read")


def test_the_number_on_a_rejected_back_keeps_the_page_read_and_is_not_re_read():
    image = np.full((400, 640, 3), 220, np.uint8)
    result = SideResult()
    data = _row_field(
        image, "nationalId", "٢٨٥٠٣١٤١٢٠١٢٣٤", 0.8, (300.0, 20.0, 620.0, 60.0),
        _NoReads(), result, NO_TRACE, "back", quick=True,
    )
    assert data["value"] == "28503141201234"
    assert [c.variant for c in result.nid_candidates] == ["page"]
