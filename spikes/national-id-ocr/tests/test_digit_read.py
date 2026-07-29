"""The national ID is read several times, and the reads are combined.

One read is not enough for this field, and the reason is specific. A real card came back with a
single digit wrong inside the sequence — a different, equally valid person, accepted by every
structural check and every confidence score, because the evidence that would separate the two
numbers is not in the number. It is in the pixels, and using it means looking more than once.

The variants are chosen to fail DIFFERENTLY (adaptive threshold, plain greyscale, Otsu, CLAHE,
inverted), so a digit that survives all of them is corroborated rather than repeated. That is also
what makes the older behaviour a special case of the new one: thresholding fragments glyphs printed
over the card's pyramid watermark and sharpens them on a clean scan, so neither choice is right for
all inputs and both are still run.

Every number here is synthetic.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.engine import Recognition  # noqa: E402
from nidocr.extract import _recognize_box  # noqa: E402
from nidocr.layout import FieldBox  # noqa: E402
from nidocr.preprocess import DIGIT_VARIANTS, binarize  # noqa: E402

VALID = "29503141234567"
#: One digit different, at position eleven, where nothing constrains it. Both validate.
NEAR_MISS = "29503141235567"

NID_BOX = FieldBox("nationalId", x=0.37, y=0.745, w=0.60, h=0.135, kind="digits")
EXPIRY_BOX = FieldBox("nationalIdExpiry", x=0.06, y=0.415, w=0.72, h=0.125, kind="digits")


class SplitByThreshold:
    """Returns one text for a binarized crop and another otherwise.

    Distinguishes the two by a property binarization actually changes — a threshold leaves only 0
    and 255 — rather than by call order, so the test cannot pass by accident if the variants are
    ever reordered.
    """

    id = "split-by-threshold"

    def __init__(self, thresholded: str, plain: str) -> None:
        self.thresholded, self.plain = thresholded, plain
        self.calls = 0

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:  # noqa: ARG002
        self.calls += 1
        is_binary = set(np.unique(crop)).issubset({0, 255})
        return Recognition(text=self.thresholded if is_binary else self.plain, score=0.9)

    def detect_lines(self, image: np.ndarray):  # noqa: ARG002
        return []


class Replay:
    """Returns a prepared sequence of reads, one per variant, in `DIGIT_VARIANTS` order."""

    id = "replay"

    def __init__(self, *texts: str, score: float = 0.9) -> None:
        self.texts = list(texts)
        self.calls = 0
        self.score = score

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:  # noqa: ARG002
        text = self.texts[self.calls] if self.calls < len(self.texts) else ""
        self.calls += 1
        return Recognition(text=text, score=self.score)

    def detect_lines(self, image: np.ndarray):  # noqa: ARG002
        return []


class Broken:
    """Raises the way the native predictor does — from inside C++, with no Python-level cause."""

    id = "broken"

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:  # noqa: ARG002
        raise RuntimeError("std::exception")

    def detect_lines(self, image: np.ndarray):  # noqa: ARG002
        return []


@pytest.fixture()
def card():
    """A mid-grey card — not already binary, so thresholding is detectable."""
    rng = np.random.default_rng(3)
    return rng.integers(60, 200, size=(646, 1024, 3), dtype=np.uint8)


# ── The reported fault ──


def test_the_number_several_variants_agree_on_beats_one_variant_s_confident_misread(card):
    """The whole reason this field is read more than once.

    The first variant reads a digit wrong and both readings are structurally valid, so nothing
    about either string says which is right. Two further variants agreeing settles it — and they
    are independent evidence, because a threshold that breaks a glyph against the watermark does
    not break it the same way a plain greyscale read does.
    """
    recognizer = Replay(NEAR_MISS, VALID, VALID, VALID)
    text, _, consensus = _recognize_box(card, NID_BOX, recognizer)

    assert text == VALID
    assert consensus is not None and consensus.valid
    assert consensus.agreement == "majority"


def test_reading_stops_once_enough_variants_agree(card):
    """Robustness is not worth paying for on every card that was already read correctly."""
    recognizer = Replay(VALID, VALID, VALID, "this must never be read")
    text, _, consensus = _recognize_box(card, NID_BOX, recognizer)

    assert text == VALID and consensus.agreement == "unanimous"
    assert recognizer.calls == 3, "a settled field kept reading"


def test_a_contested_field_pays_for_the_whole_ensemble(card):
    """When the variants genuinely disagree, every one of them is worth its latency."""
    recognizer = Replay(VALID, NEAR_MISS, VALID, NEAR_MISS, VALID)
    _recognize_box(card, NID_BOX, recognizer)
    assert recognizer.calls == len(DIGIT_VARIANTS)


def test_no_valid_candidate_is_reported_rather_than_accepted(card):
    """A number that cannot be a national ID must not arrive looking like one that was read."""
    recognizer = Replay(*(["99999999999999"] * len(DIGIT_VARIANTS)))
    text, _, consensus = _recognize_box(card, NID_BOX, recognizer)

    assert consensus is not None and not consensus.valid
    assert text == "99999999999999", "the reviewer still needs something to correct"


# ── Choosing per input, which the ensemble subsumes ──


def test_the_read_that_recovers_more_digits_still_wins(card):
    """Thresholding fragments glyphs printed over the watermark; greyscale keeps them."""
    recognizer = SplitByThreshold(thresholded="2964", plain=VALID)
    text, _, _ = _recognize_box(card, NID_BOX, recognizer)
    assert text == VALID


def test_thresholding_still_wins_when_it_reads_better(card):
    """The point is choosing per input, not preferring one path."""
    recognizer = SplitByThreshold(thresholded=VALID, plain="296")
    text, _, _ = _recognize_box(card, NID_BOX, recognizer)
    assert text == VALID


def test_the_expiry_is_not_put_through_the_ensemble(card):
    """It has no fourteen-digit shape, so several reads of it cannot be combined position by
    position — two dates that disagree cannot be voted on. It keeps the older, cheaper pair."""
    recognizer = SplitByThreshold(thresholded="٢٠٢٢/٠٧/٠٤", plain="٢٠٢٢")
    _, _, consensus = _recognize_box(card, EXPIRY_BOX, recognizer)

    assert recognizer.calls == 2
    assert consensus is None


# ── Prose fields ──


def test_text_fields_are_read_once(card):
    """The extra passes buy nothing for Arabic prose: two reads that disagree cannot be
    adjudicated, because unlike the number a name has no structure to check a candidate against."""
    box = FieldBox("fullNameAr", x=0.36, y=0.18, w=0.61, h=0.28, kind="text")
    recognizer = SplitByThreshold(thresholded="x", plain="y")
    _recognize_box(card, box, recognizer)
    assert recognizer.calls == 1


def test_an_empty_prose_read_is_tried_once_more_with_more_contrast(card):
    """'Nothing at all' is the one prose outcome that is unambiguous, so it is worth a retry."""
    box = FieldBox("fullNameAr", x=0.36, y=0.18, w=0.61, h=0.28, kind="text")
    recognizer = Replay("", "سلمى إبراهيم")
    text, _, _ = _recognize_box(card, box, recognizer)

    assert text == "سلمى إبراهيم"
    assert recognizer.calls == 2


# ── Failure ──


def test_a_recognizer_that_raises_costs_the_field_and_not_the_card(card):
    """The recognizer is native code and can raise with no Python-level cause. Letting that
    propagate turns one unreadable crop into a failed scan for a card whose other fields read."""
    box = FieldBox("fullNameAr", x=0.36, y=0.18, w=0.61, h=0.28, kind="text")
    text, score, _ = _recognize_box(card, box, Broken())
    assert (text, score) == ("", 0.0)


def test_binarize_really_does_produce_a_two_valued_image(card):
    """Guards the discriminator the threshold tests rely on."""
    assert set(np.unique(binarize(card))).issubset({0, 255})
