"""Reading by rows: every line read first, fields assigned from what the card prints in order."""

from __future__ import annotations

import numpy as np

from nidocr.rows import read_by_rows


def _line(text: str, left: float, top: float, right: float, bottom: float, score: float = 0.95):
    return (np.array([[left, top], [right, top], [right, bottom], [left, bottom]]), text, score)


class PageReader:
    id = "page"

    def __init__(self, lines):
        self._lines = lines

    def read_page(self, image):  # noqa: ARG002
        return list(self._lines)


IMAGE = np.zeros((2000, 3100, 3), np.uint8)

FRONT = [
    _line("بطاقة تحقيق", 1990, 280, 2440, 450),
    _line("الشخصية", 1620, 295, 2020, 450),
    _line("كريم", 2630, 530, 2900, 670),
    _line("سامي علي", 2350, 680, 2920, 850),
    _line("حسن", 2050, 690, 2360, 870),
    _line("١٢ ش النيل", 2160, 910, 2920, 1080),
    _line("الدقي", 1420, 920, 2190, 1100),
    _line("الجيزة", 1950, 1090, 2900, 1250),
    _line("١٠٤٣٣٥", 2420, 1490, 3000, 1650),
    _line("٢٩٠٠١١٥", 1450, 1520, 2300, 1690),
    _line("AB1234567", 290, 1800, 1060, 1970),
]

BACK = [
    _line("٢٠١٩١٧", 900, 95, 1350, 245),
    _line("٢٩٠٠١١٥١٠١٠٤٣٥", 1550, 105, 2550, 240),
    _line("مهندس", 2340, 255, 2560, 395),
    _line("ذكر", 2400, 560, 2600, 720),
    _line("مسلم", 1870, 580, 2090, 700),
    _line("متزوج", 1140, 555, 1440, 745),
    _line("البطاقة سارية", 1940, 875, 2600, 1055),
    _line("٢٠٢٦١١٢١٢٥", 1080, 910, 1750, 1040),
]


def test_the_front_name_takes_both_rows_and_the_header_is_dropped():
    fields = read_by_rows(IMAGE, "front", PageReader(FRONT)).fields
    assert fields["fullNameAr"][0] == "كريم سامي علي حسن"
    assert "بطاقة" not in fields["fullNameAr"][0]


def test_the_address_is_every_prose_row_after_the_name():
    assert read_by_rows(IMAGE, "front", PageReader(FRONT)).fields["address"][0] == (
        "١٢ ش النيل الدقي الجيزة"
    )


def test_the_id_groups_are_joined_left_to_right_and_the_latin_serial_is_ignored():
    assert read_by_rows(IMAGE, "front", PageReader(FRONT)).fields["nationalId"][0] == (
        "2900115104335"
    )


def test_the_back_id_is_not_glued_to_the_issue_date_on_its_row():
    assert read_by_rows(IMAGE, "back", PageReader(BACK)).fields["nationalId"][0] == (
        "29001151010435"
    )


def test_the_back_status_row_fills_religion_and_marital_status_from_the_vocabularies():
    fields = read_by_rows(IMAGE, "back", PageReader(BACK)).fields
    assert fields["religion"][0].split()[-1] == "مسلم"
    assert fields["maritalStatus"][0].split()[-1] == "متزوج"


def test_occupation_is_the_prose_between_the_id_row_and_the_status_row():
    assert read_by_rows(IMAGE, "back", PageReader(BACK)).fields["occupation"][0] == "مهندس"


def test_the_expiry_is_the_dated_line_on_the_validity_row():
    assert read_by_rows(IMAGE, "back", PageReader(BACK)).fields["nationalIdExpiry"][0] == (
        "٢٠٢٦١١٢١٢٥"
    )


def test_a_recognizer_without_read_page_leaves_the_box_path_in_charge():
    class BoxesOnly:
        def detect_lines(self, image):  # noqa: ARG002
            return []

    assert read_by_rows(IMAGE, "front", BoxesOnly()) is None


def test_a_name_on_one_row_does_not_swallow_the_first_address_row():
    one_row_name = [line for line in FRONT if line[1] not in ("كريم",)]
    fields = read_by_rows(IMAGE, "front", PageReader(one_row_name)).fields
    assert fields["fullNameAr"][0] == "سامي علي حسن"
    assert fields["address"][0] == "١٢ ش النيل الدقي الجيزة"


def test_a_house_number_run_into_the_street_gets_its_space_back():
    from nidocr.postprocess import clean_address

    assert clean_address("٣٥٥زهراء مدينة نصر")[0].startswith("٣٥٥ زهراء")


def test_a_blurred_religion_is_taken_from_its_place_beside_the_sex_word():
    blurred = [line for line in BACK if line[1] != "مسلم"] + [_line("مسد", 1870, 580, 2090, 700)]
    fields = read_by_rows(IMAGE, "back", PageReader(blurred)).fields
    assert fields["religion"][0].split()[-1] == "مسلم"
    assert fields["religion"][1] <= 0.6  # a deduction, kept below the review threshold


def test_a_tilted_card_is_measured_from_its_long_lines():
    from nidocr.rows import _skew

    def tilted(left, top, length, height, degrees):
        angle = np.radians(degrees)
        along = np.array([np.cos(angle), np.sin(angle)]) * length
        down = np.array([-np.sin(angle), np.cos(angle)]) * height
        origin = np.array([left, top], dtype=float)
        return np.array([origin, origin + along, origin + along + down, origin + down])

    found = [(tilted(100, 100 + 80 * i, 900, 60, 6.0), "سطر", 0.9) for i in range(4)]
    assert abs(_skew(found) - 6.0) < 0.1
    level = [(tilted(100, 100 + 80 * i, 900, 60, 0.3), "سطر", 0.9) for i in range(4)]
    assert _skew(level) is None  # below a degree: not worth a re-read


def test_a_house_number_read_as_its_own_line_stays_in_the_address():
    split = [line for line in FRONT if line[1] != "١٢ ش النيل"] + [
        _line("١٢", 2700, 910, 2920, 1080),
        _line("ش النيل", 2160, 910, 2690, 1080),
    ]
    assert read_by_rows(IMAGE, "front", PageReader(split)).fields["address"][0] == (
        "١٢ ش النيل الدقي الجيزة"
    )


def test_a_stray_number_on_a_name_row_is_not_part_of_the_name():
    noisy = FRONT + [_line("52", 1500, 540, 1580, 660)]
    assert read_by_rows(IMAGE, "front", PageReader(noisy)).fields["fullNameAr"][0] == "كريم سامي علي حسن"


def test_a_blurred_religion_is_found_beside_the_marital_status_when_the_sex_word_is_lost_too():
    lost = [line for line in BACK if line[1] not in ("مسلم", "ذكر")] + [
        _line("مسد", 1870, 580, 2090, 700),
        _line("WR", 2400, 560, 2600, 720),
    ]
    assert read_by_rows(IMAGE, "back", PageReader(lost)).fields["religion"][0].split()[-1] == "مسلم"


def test_a_given_name_is_kept_when_the_header_did_not_read_at_all():
    # Glare or a distant photo can lose the header entirely. The top of the text is then the
    # given name, and dropping 'the first quarter' by position used to drop the name with it.
    no_header = [line for line in FRONT if line[1] not in ("بطاقة تحقيق", "الشخصية")]
    fields = read_by_rows(IMAGE, "front", PageReader(no_header)).fields
    assert fields["fullNameAr"][0] == "كريم سامي علي حسن"
    assert fields["address"][0] == "١٢ ش النيل الدقي الجيزة"


def test_a_short_given_name_alone_on_its_row_survives_a_lost_header():
    no_header = [
        line for line in FRONT if line[1] not in ("بطاقة تحقيق", "الشخصية", "كريم")
    ] + [_line("مي", 2760, 530, 2900, 670)]
    assert read_by_rows(IMAGE, "front", PageReader(no_header)).fields["fullNameAr"][0] == (
        "مي سامي علي حسن"
    )


def test_an_unreadable_card_title_is_dropped_by_its_position_not_taken_for_the_name():
    garbled = [line for line in FRONT if line[1] not in ("بطاقة تحقيق", "الشخصية")] + [
        _line("سهوزد مة", 1700, 290, 2400, 440),
    ]
    fields = read_by_rows(IMAGE, "front", PageReader(garbled)).fields
    assert fields["fullNameAr"][0] == "كريم سامي علي حسن"
    assert fields["address"][0] == "١٢ ش النيل الدقي الجيزة"


def test_a_female_card_keeps_the_feminine_forms_when_the_final_ta_marbuta_is_lost():
    from nidocr.postprocess import clean_marital_status, clean_religion

    female = [line for line in BACK if line[1] != "ذكر"] + [_line("أنثى", 2400, 560, 2600, 720)]
    fields = read_by_rows(IMAGE, "back", PageReader(female)).fields
    assert clean_marital_status(fields["maritalStatus"][0])[0] == "متزوجة"
    assert clean_religion(fields["religion"][0])[0] == "مسلمة"


def test_the_latin_serial_never_joins_the_national_id():
    serial_on_row = [line for line in FRONT if line[1] != "AB1234567"] + [
        _line("AB1234567", 290, 1500, 1060, 1680),
    ]
    raw = read_by_rows(IMAGE, "front", PageReader(serial_on_row)).fields["nationalId"][0]
    assert "1234567" not in raw


def test_an_id_piece_that_starts_like_a_year_is_kept_when_dropping_it_would_lose_digits():
    pieces = [line for line in FRONT if line[1] not in ("١٠٤٣٣٥", "٢٩٠٠١١٥")] + [
        _line("٢٠١٢", 2700, 1490, 3000, 1650),
        _line("٢٩٠٠١١٥١٠", 1450, 1520, 2650, 1690),
    ]
    assert read_by_rows(IMAGE, "front", PageReader(pieces)).fields["nationalId"][0] == "2900115102012"


def test_name_and_address_come_from_the_same_read_so_no_name_line_falls_between_them():
    from nidocr.rows import RowRead, _merge

    two_row = RowRead(fields={"fullNameAr": ("كريم سامي علي حسن", 0.80, (0, 0, 1, 1)),
                              "address": ("١٢ ش النيل الجيزة", 0.80, (0, 0, 1, 1))},
                      images={"fullNameAr": IMAGE, "address": IMAGE}, passes=["photo"])
    one_row = RowRead(fields={"fullNameAr": ("كريم", 0.99, (0, 0, 1, 1)),
                              "address": ("١٢ ش النيل الجيزة", 0.99, (0, 0, 1, 1))},
                      images={"fullNameAr": IMAGE, "address": IMAGE}, passes=["enhanced"])
    merged = _merge([two_row, one_row])
    assert merged.fields["fullNameAr"][0] == "كريم سامي علي حسن"


def test_the_governorate_keeps_the_cards_own_spelling_when_only_ya_and_alef_maqsura_differ():
    from nidocr.postprocess import clean_address

    assert clean_address("مركز سمسطا بنى سويف")[0].endswith("بنى سويف")


def test_an_id_row_with_only_some_groups_found_is_still_the_id_row_not_the_date():
    pieces = [line for line in FRONT if line[1] not in ("١٠٤٣٣٥", "٢٩٠٠١١٥")] + [
        _line("٢٠٠٠١٠٤٥", 300, 1480, 900, 1640),  # the front's issue date, slash misread
        _line("٢٢ ٧", 2300, 1500, 2700, 1680),
        _line("٥٣٥", 2750, 1500, 3000, 1680),
    ]
    raw = read_by_rows(IMAGE, "front", PageReader(pieces)).fields["nationalId"][0]
    assert raw == "227535"


def test_a_latin_digit_in_the_address_becomes_the_arabic_indic_one_the_card_prints():
    from nidocr.postprocess import clean_address

    assert clean_address("1 شارع المحمدى")[0] == "١ شارع المحمدى"


def test_an_address_row_with_its_hyphen_lost_is_still_an_address():
    """'البراهمه-نجع جوده' read without its hyphen glued نجع onto the village name."""
    from nidocr.rows import _looks_like_address

    assert _looks_like_address("البراهمهنجع جوده")
    assert _looks_like_address("البراهمه-نجع جوده")
    assert _looks_like_address("عزبة الشيخ")


def test_a_name_row_is_not_taken_for_an_address():
    from nidocr.rows import _looks_like_address

    assert not _looks_like_address("عبدالمنعم محمود على")
    assert not _looks_like_address("محمد الكفراوى")  # كفر inside a family name is not the village


# ── recovering a given name the page detector dropped ────────────────────────────────────────────


class _Out:
    def __init__(self, text: str, score: float) -> None:
        self.text, self.score = text, score


class _WidthReader:
    """Reads 'هدى' when handed just the word, and the background too when handed the whole strip."""

    def __init__(self) -> None:
        self.widths: list[int] = []

    def recognize(self, crop, rtl=True):
        self.widths.append(crop.shape[1])
        return _Out("هدى" if crop.shape[1] < 600 else "هدىه", 0.85)


def _strip_with_word(width: int = 1000, height: int = 100) -> np.ndarray:
    strip = np.full((height, width, 3), 215, np.uint8)
    strip[:, 300:500] = (120, 170, 210)  # a pyramid: tinted, not dark
    strip[30:70, 900:980] = 30  # the printed word, near-black, at the right end
    return strip


def test_ink_columns_find_the_printed_word_and_not_the_background():
    from nidocr.rows import _ink_columns

    assert _ink_columns(_strip_with_word()) == (900, 979)
    assert _ink_columns(np.full((100, 1000, 3), 215, np.uint8)) is None


def test_a_probe_reads_only_the_inked_part_of_its_strip():
    from nidocr.rows import _probe

    reader = _WidthReader()
    image = np.full((400, 1200, 3), 215, np.uint8)
    image[100:200, 100:1100] = _strip_with_word()
    assert _probe(image, (100, 100, 1100, 200), reader) == ("هدى", 0.85)
    assert reader.widths and reader.widths[0] < 600


def test_one_stray_letter_or_a_split_does_not_cost_a_known_name():
    from nidocr.rows import _known_after_one_stray

    assert _known_after_one_stray("هدىه") == "هدى"
    assert _known_after_one_stray("هد ى") == "هدى"
    assert _known_after_one_stray("ززززز") is None


class CountingReader(PageReader):
    def __init__(self, lines):
        super().__init__(lines)
        self.reads = 0

    def read_page(self, image):  # noqa: ARG002
        self.reads += 1
        return list(self._lines)


def test_a_weak_read_is_retried_but_not_when_told_the_photo_is_hopeless():
    """A side with fields missing is read again (zoomed, enhanced). A photo the quality gate already
    rejected for blur or glare gains nothing from that and cost a live card 25 s: read once."""
    weak = [line for line in BACK if line[1] not in ("مسلم", "متزوج")]
    retried = CountingReader(weak)
    read_by_rows(IMAGE, "back", retried)
    once = CountingReader(weak)
    read_by_rows(IMAGE, "back", once, retry=False)
    assert retried.reads > 1
    assert once.reads == 1
