"""Combining several readings of the national ID."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.ensemble import Candidate, combine  # noqa: E402
from nidocr.nid import is_structurally_valid  # noqa: E402

TODAY = dt.date(2026, 7, 29)
VALID = "29503141234567"
#: The same number with one digit changed at position eleven, inside the sequence, where nothing
#: constrains it. This is the shape of the reported fault: a different, equally valid person.
NEAR_MISS = "29503141235567"


def _reads(*pairs: tuple[str, float]) -> list[Candidate]:
    return [
        Candidate(variant=f"v{index}", digits=digits, score=score)
        for index, (digits, score) in enumerate(pairs)
    ]


def _combine(*pairs: tuple[str, float]):
    return combine(_reads(*pairs), today=TODAY)


def test_both_numbers_in_these_tests_are_valid():
    """Guards the whole file: if either stopped validating, every assertion below changes meaning.
    """
    assert is_structurally_valid(VALID, today=TODAY)
    assert is_structurally_valid(NEAR_MISS, today=TODAY)
    assert sum(a != b for a, b in zip(VALID, NEAR_MISS)) == 1


# ── Agreement ──


def test_reads_that_all_agree_are_reported_as_unanimous():
    settled = _combine((VALID, 0.9), (VALID, 0.88), (VALID, 0.91))
    assert (settled.value, settled.agreement, settled.support) == (VALID, "unanimous", 3)
    assert settled.valid and not settled.deduced


def test_the_agreed_number_beats_a_higher_scoring_lone_disagreement():
    """The reported fault, reduced to its essentials."""
    settled = _combine((NEAR_MISS, 0.99), (VALID, 0.80), (VALID, 0.78))
    assert settled.value == VALID
    assert settled.agreement == "majority" and settled.support == 2


def test_a_lone_valid_read_is_kept_but_marked_as_such():
    settled = _combine((VALID, 0.9), ("123", 0.4))
    assert settled.value == VALID
    assert settled.agreement == "single" and settled.total == 1


# ── Voting, when nothing agrees outright ──


def test_reads_that_each_get_one_digit_wrong_are_voted_back_together():
    """No two reads are identical, yet every position has a clear majority."""
    first = "3" + VALID[1:]  # wrong century
    second = VALID[:10] + "9" + VALID[11:]  # wrong sequence digit
    third = VALID[:13] + "0"  # wrong parity digit

    settled = _combine((first, 0.9), (second, 0.9), (third, 0.9))
    assert settled.value == VALID
    assert settled.agreement == "voted" and settled.deduced
    assert settled.support == 0, "no single variant produced this — that is the point"


def test_a_voted_value_does_not_inherit_the_best_read_s_score():
    """It was not read; it was assembled. The score has to describe the evidence that existed."""
    first = "3" + VALID[1:]
    second = VALID[:10] + "9" + VALID[11:]
    settled = _combine((first, 0.99), (second, 0.55), (VALID[:13] + "0", 0.60))
    assert settled.deduced
    assert settled.score < 0.99


def test_agreement_wins_over_voting_even_when_voting_would_differ():
    """Two variants landing on the same fourteen digits is evidence; a positional majority is a
    reconstruction. Where both are available, the thing that was actually read wins.
    """
    settled = _combine((VALID, 0.7), (VALID, 0.7), (NEAR_MISS, 0.99), (NEAR_MISS, 0.99))
    assert settled.value in (VALID, NEAR_MISS)
    assert settled.agreement == "majority", "a reconstruction must not displace a real agreement"


# ── Refusing ──


def test_no_valid_reading_is_reported_as_invalid_rather_than_dressed_up():
    """The value still goes to the reviewer, with `valid` false, so nothing treats it as read."""
    settled = _combine(("99999999999999", 0.9), ("99999999999999", 0.9))
    assert settled is not None
    assert not settled.valid
    assert settled.value == "99999999999999", "the reviewer needs something to correct"


def test_nothing_of_the_right_length_yields_no_consensus_at_all():
    """The caller then falls back to its best raw read, which is still worth showing a human."""
    assert _combine(("2950314", 0.9), ("", 0.0)) is None
    assert combine([], today=TODAY) is None


def test_the_diagnostics_carry_counts_and_never_the_number():
    """This rides into logs and the API's `diagnostics`, where card content must not go."""
    settled = _combine((VALID, 0.9), (VALID, 0.9))
    reported = settled.as_diagnostics()
    assert set(reported) == {"agreement", "support", "reads"}
    assert VALID not in str(reported)


# ── Partial reads ──
#
# The real fault: the sharp greyscale reads kept every stroke of ٥٣٥ but dropped the dot-sized
# zeros at the row's start, so they came back short and did not vote; the thresholded reads kept
# the zeros but filled the ring of ٥ into ٠, came back with fourteen digits, and won.

#: A synthetic number ending ٥٣٥, and the same number with that ٥٣٥ read as ٠٣٠.
FIVES = "29503141235535"
FIVES_AS_ZEROS = "29503141230030"


def _sourced(*reads: tuple[str, str, float]) -> list[Candidate]:
    return [Candidate(variant=variant, digits=digits, score=score) for variant, digits, score in reads]


def test_partial_reads_overrule_full_reads_they_do_not_fit():
    assert is_structurally_valid(FIVES, today=TODAY)
    assert is_structurally_valid(FIVES_AS_ZEROS, today=TODAY)
    reads = _sourced(
        ("page", FIVES[2:], 0.98),
        ("grey", FIVES[3:], 0.97),
        ("thick", FIVES[3:], 0.97),
        ("clahe", FIVES[2:], 0.97),
        ("binary", FIVES_AS_ZEROS, 0.80),
        ("widened2:binary", FIVES_AS_ZEROS, 0.82),
        ("otsu", FIVES_AS_ZEROS, 0.81),
        ("widened2:thick", FIVES, 0.94),
    )
    settled = combine(reads, today=TODAY)
    assert settled.value == FIVES
    # A count that was overruled is a contest: flagged as a deduction, never the top band.
    assert settled.agreement == "backed"
    assert settled.deduced


def test_a_partial_read_is_completed_from_a_full_one():
    """No read has all fourteen right; the short sharp reads plus a full read's first digits do."""
    reads = _sourced(
        ("grey", FIVES[4:], 0.96),
        ("thick", FIVES[4:], 0.98),
        ("clahe", FIVES[4:], 0.95),
        ("otsu", FIVES_AS_ZEROS, 0.73),
        ("invert", FIVES_AS_ZEROS, 0.73),
    )
    settled = combine(reads, today=TODAY)
    assert settled.value == FIVES
    assert settled.support == 0


def test_the_same_filter_on_a_widened_crop_is_one_source():
    reads = _sourced(
        ("grey", FIVES, 0.9),
        ("binary", FIVES_AS_ZEROS, 0.9),
        ("widened2:binary", FIVES_AS_ZEROS, 0.9),
        ("widened4:binary", FIVES_AS_ZEROS, 0.9),
    )
    # Three binary reads are one opinion, so the count (3 to 1) is not overruled by backing alone,
    # and backing does not invent a margin for it either.
    settled = combine(reads, today=TODAY)
    assert settled.value == FIVES_AS_ZEROS
    assert settled.margin == 1.0


def test_reads_that_fit_both_numbers_do_not_dilute_the_ones_that_separate_them():
    """The back's widened read took the ٢ ending the issue date beside the ID: 2… against 3…."""
    true = "30512180101234"
    with_date_digit = "2" + true[1:]
    # The borrowed digit now also makes the holder 123 years old, which no card holder is: the
    # rival is ruled out by structure before the vote is needed. The vote must still agree.
    assert is_structurally_valid(true, today=TODAY) and not is_structurally_valid(with_date_digit, today=TODAY)
    reads = _sourced(
        ("front:page", true, 0.99), ("front:grey", true, 0.98), ("front:thick", true, 0.98),
        ("back:page", true[4:], 0.97), ("back:grey", true[2:], 0.92), ("back:thick", true[2:], 0.96),
        ("back:widened2:thick", with_date_digit, 0.83), ("back:widened2:grey", with_date_digit[:-1] + "0", 0.73),
    )
    settled = combine(reads, today=TODAY)
    assert settled.value == true
    # The back's short reads fit both and decide nothing; the front's three reads decide it.
    assert settled.margin >= 1.5
