"""Which way up a certificate is, decided by its own printed form words.

Measured: the general text-confidence check turned upright certificates for no reason (a worn
certificate reads at a low mean confidence however it lies), and digits read almost as well upside
down. The certificate's printed words (وزارة الدفاع, تاريخ الميلاد, رقم القرار, ...) are only read
the right way up, so their count is the witness. A turn is made only on clear evidence.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.army_exemption import load_profile, upright_certificate  # noqa: E402

PROFILE = load_profile(ROOT / "profiles" / "documents" / "army-exemption.json")
FORM = ["وزارة الدفاع", "شهادة بالإعفاء", "تاريخ الميلاد", "رقم البطاقة العسكرية", "الرقم القومي", "رقم القرار",
        "تاريخ القرار"]
NOISE = ["ﻊﻓﺍﺪﻟﺍ", "٧١٨ ٠٠٢", "ﺓﺩﺎﻬﺷ", "ll ١١"]


def box(i):
    return [[10, 10 + 40 * i], [300, 10 + 40 * i], [300, 40 + 40 * i], [10, 40 + 40 * i]]


def tall_box(i):
    return [[10 + 40 * i, 10], [40 + 40 * i, 10], [40 + 40 * i, 300], [10 + 40 * i, 300]]


def photo(turned_by=0):
    """A blank page with a mark at its top-left corner, turned clockwise by `turned_by`."""
    image = np.zeros((120, 200, 3), np.uint8)
    image[:10, :10] = 255
    return np.rot90(image, k=-(turned_by // 90)).copy()


def is_upright(image):
    return image.shape[:2] == (120, 200) and image[:10, :10].mean() > 200


class Reader:
    """Reads the form words only when the page is upright; noise, and score, otherwise."""

    def __init__(self, upright_words=FORM, upright_score=0.6, sideways_noise=False):
        self.words, self.score, self.sideways_noise = upright_words, upright_score, sideways_noise
        self.calls = 0

    def detect_lines(self, image):
        self.calls += 1
        if is_upright(image):
            return [(box(i), word, self.score) for i, word in enumerate(self.words)]
        if image.shape[:2] != (120, 200):  # on its side: tall boxes, as the detector gives them
            return [(tall_box(i), word, 0.9) for i, word in enumerate(NOISE)]
        return [(box(i), word, 0.95) for i, word in enumerate(NOISE)]


def test_an_upright_certificate_read_with_low_confidence_is_not_turned():
    reader = Reader(upright_score=0.55)
    image, turned, lines = upright_certificate(photo(0), reader, PROFILE)
    assert turned == 0 and is_upright(image)
    assert reader.calls == 1  # enough form words as given: no other way up is read
    assert len(lines) == len(FORM)


def test_an_upside_down_certificate_is_turned():
    image, turned, _ = upright_certificate(photo(180), Reader(), PROFILE)
    assert turned == 180 and is_upright(image)


def test_a_certificate_on_its_side_is_turned_either_way():
    for given, needed in ((90, 270), (270, 90)):
        image, turned, _ = upright_certificate(photo(given), Reader(), PROFILE)
        assert turned == needed and is_upright(image), given


def test_without_form_words_any_way_up_the_photo_is_left_as_given():
    image, turned, _ = upright_certificate(photo(180), Reader(upright_words=["كلام", "اخر"]), PROFILE)
    assert turned == 0


def test_a_narrow_lead_is_no_reason_to_turn():
    # As given, 3 form words; turned, one more: not clear enough to turn the page.
    class Close(Reader):
        def detect_lines(self, image):
            self.calls += 1
            words = FORM[:4] if is_upright(image) else FORM[:3]
            return [(box(i), word, 0.9) for i, word in enumerate(words)]

    _, turned, _ = upright_certificate(photo(180), Close(), PROFILE)
    assert turned == 0


def test_a_certificate_on_its_side_is_turned_even_when_its_words_read_sideways():
    # Measured: the page reader turns each tall line box itself and reads the words right, so the
    # words alone said "upright" while every line ran down the page.
    class ReadsSideways(Reader):
        def detect_lines(self, image):
            self.calls += 1
            if image.shape[:2] != (120, 200):
                return [(tall_box(i), word, 0.9) for i, word in enumerate(FORM)]
            return super().detect_lines(image)

    for given, needed in ((90, 270), (270, 90)):
        image, turned, _ = upright_certificate(photo(given), ReadsSideways(), PROFILE)
        assert turned == needed and is_upright(image), given
