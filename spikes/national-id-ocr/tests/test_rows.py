"""Reading by rows: every line read first, fields assigned from what the card prints in order.

The lines below are made up — the row SHAPES are the ones the real model returned on a real card
(a name split across two rows and several pieces, an ID row read as two groups, the back's ID row
sharing a line with the issue date whose slash came back as ١), but no text is anyone's.
"""

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
