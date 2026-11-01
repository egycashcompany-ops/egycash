"""The military card's number, printed as three groups of digits: found and read group by group.

Measured on the real samples: the page detector loses faint groups (Arabic zeros are dots), and a
closer read of the whole row can merge or reverse them. Synthetic images only: blocks stand in for
digits, small squares for the dot-shaped Arabic zero.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.army_exemption import load_profile, pick_number, read_exemption_page, split_groups  # noqa: E402

PROFILE = load_profile(ROOT / "profiles" / "documents" / "army-exemption.json")


def strip(groups, gap, inner=6, height=40, dot_gap=None):
    """A white strip with black 'digits': each group a list of 'd' (a tall block) or '0' (a dot)."""
    image = np.full((height, 900, 3), 255, np.uint8)
    x = 20
    for group in groups:
        for glyph in group:
            if glyph == "0":
                image[height // 2 - 3:height // 2 + 3, x:x + 6] = 0
                x += 6 + (dot_gap if dot_gap is not None else inner)
            else:
                image[8:height - 8, x:x + 12] = 0
                x += 12 + inner
        x += gap
    return image


def test_three_groups_are_found_between_the_widest_gaps():
    image = strip(["ddd", "ddd", "d000"], gap=40)
    candidates = split_groups(image, expected=3)
    assert any(len(split) == 3 for split in candidates)


def test_the_gaps_round_a_dotted_zero_do_not_fool_every_split():
    # Measured: on one sample the gaps round the dot-zeros were as wide as the gaps between groups.
    image = strip(["ddd", "ddd", "d00d"], gap=34, dot_gap=30)
    candidates = split_groups(image, expected=3)
    widths = [[b - a for a, b in split] for split in candidates]
    assert any(len(w) == 3 and w[2] > w[0] for w in widths), widths


def test_coloured_ink_and_far_specks_are_not_digits():
    image = strip(["ddd", "ddd", "dddd"], gap=40)
    image[:, 860:866] = (40, 40, 220)    # a red marker line, as drawn on one sample
    image[18:20, 880:882] = 0            # a far speck
    for split in split_groups(image, expected=3):
        assert split[-1][1] < 800


def test_the_number_most_reads_agree_on_wins():
    value, agreed = pick_number(["1995123456", "1995123456", "19951256"], lengths=[4, 3, 3])
    assert value == "1995123456" and agreed


def test_a_number_of_the_printed_shape_wins_over_a_longer_misread():
    value, agreed = pick_number(["199512345699", "1995123456"], lengths=[4, 3, 3])
    assert value == "1995123456" and not agreed


def test_no_read_of_the_printed_shape_gives_nothing():
    assert pick_number(["123", "45678"], lengths=[4, 3, 3]) == (None, False)


# --- On the page: a closer read that says whether reads agreed --------------------------------

NID = "29503141234567"


def line(text, left, top, right, bottom, score=0.9):
    return {"text": text, "score": score, "box": [left, top, right, bottom]}


def page(mil):
    return [
        line("وزارة الدفاع", 1448, 313, 1701, 387),
        line("شهادة بالإعفاء النهائي", 910, 434, 1230, 494),
        line("الاسم واللقب", 1540, 670, 1674, 709), line("محمد احمد علي حسن", 1100, 677, 1480, 705),
        line("تاريخ الميلاد", 822, 673, 953, 705), line("1995/03/14", 528, 658, 709, 693),
        line("رقم البطاقة العسكرية", 1424, 728, 1647, 762),
        line("الرقم القومي وجهة صدوره", 1044, 737, 1317, 775),
        line(NID, 990, 808, 1268, 839),
        *mil,
    ]


def test_a_partial_first_read_is_replaced_by_agreeing_closer_reads():
    lines = page([line("123", 1492, 815, 1550, 839), line("456", 1410, 809, 1476, 842)])
    got = read_exemption_page(lines, PROFILE, today=date(2026, 10, 15),
                              reread=lambda box, kind: ("1995123456", True) if kind.startswith("groups") else None)
    assert got.fields["militaryNumber"]["value"] == "1995123456"
    assert got.fields["militaryNumber"]["confidence"] == "medium"


def test_a_closer_read_no_other_read_agrees_with_is_shown_low():
    lines = page([line("123", 1492, 815, 1550, 839), line("456", 1410, 809, 1476, 842)])
    got = read_exemption_page(lines, PROFILE, today=date(2026, 10, 15),
                              reread=lambda box, kind: ("1995123456", False) if kind.startswith("groups") else None)
    assert got.fields["militaryNumber"]["value"] == "1995123456"
    assert got.fields["militaryNumber"]["confidence"] == "low"


def test_a_first_read_of_the_printed_shape_the_closer_read_confirms_stays_medium():
    lines = page([line("1995 123 456", 1390, 809, 1650, 842)])
    got = read_exemption_page(lines, PROFILE, today=date(2026, 10, 15),
                              reread=lambda box, kind: ("1995123456", True) if kind.startswith("groups") else None)
    assert got.fields["militaryNumber"]["confidence"] == "medium"
    assert "readsDisagree" not in got.fields["militaryNumber"]


def test_closer_reads_given_as_candidates_are_weighed_with_the_first_read():
    # The service hands back every read it made, best first; the page counts its own read in.
    lines = page([line("1995 123 456", 1390, 809, 1650, 842)])
    got = read_exemption_page(lines, PROFILE, today=date(2026, 10, 15),
                              reread=lambda box, kind: ["1995123456", "1995723456"] if kind == "groups" else None)
    assert got.fields["militaryNumber"]["value"] == "1995123456"
    assert got.fields["militaryNumber"]["confidence"] == "medium"


def test_a_partial_first_read_takes_the_best_candidate_shown_low_when_alone():
    lines = page([line("123", 1492, 815, 1550, 839)])
    got = read_exemption_page(lines, PROFILE, today=date(2026, 10, 15),
                              reread=lambda box, kind: ["1995123456", "1888123999"] if kind == "groups" else None)
    assert got.fields["militaryNumber"]["value"] == "1995123456"
    assert got.fields["militaryNumber"]["confidence"] == "low"


def test_two_candidates_that_agree_are_medium():
    lines = page([line("123", 1492, 815, 1550, 839)])
    got = read_exemption_page(lines, PROFILE, today=date(2026, 10, 15),
                              reread=lambda box, kind: ["1995123456", "1995123456"] if kind == "groups" else None)
    assert got.fields["militaryNumber"]["confidence"] == "medium"


def test_a_full_first_read_no_candidate_matches_is_kept_low():
    lines = page([line("1995 123 456", 1390, 809, 1650, 842)])
    got = read_exemption_page(lines, PROFILE, today=date(2026, 10, 15),
                              reread=lambda box, kind: ["1888123999"] if kind == "groups" else None)
    assert got.fields["militaryNumber"]["value"] == "1995123456"
    assert got.fields["militaryNumber"]["confidence"] == "low"
    assert got.fields["militaryNumber"]["readsDisagree"] is True


def test_a_mark_of_two_specks_far_from_the_number_is_dropped():
    image = strip(["ddd", "ddd", "dddd"], gap=40)
    image[18:22, 820:828] = 0
    image[18:22, 831:834] = 0
    for split in split_groups(image, expected=3):
        assert split[-1][1] < 800
