"""Combining several readings of the national ID.

THE FAULT THIS ANSWERS. A card printed a number and the pipeline returned it with one digit wrong,
inside the sequence. Both strings were structurally valid — same century, same birth date, same
governorate — so `is_structurally_valid` accepted each, `parseNationalId` decoded each into a
consistent person, and nothing downstream had any way to prefer one. Validation cannot catch this
class of error and no amount of tightening it will, because the information that separates the two
numbers is not in the number.

It is in the pixels, and it is recoverable by reading them more than once under preprocessing that
fails differently. Then the digit five reads agree on is corroborated, and the digit one read
disagrees on is outvoted.

Every number here is synthetic: structurally valid, and issued to nobody.
"""

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
#: The same number with one digit changed at position eleven — inside the sequence, where nothing
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

    This is the premise — structure cannot separate these two, so any test that appears to show
    structure separating them is testing something else.
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
    """The reported fault, reduced to its essentials.

    One variant reads a digit wrong and is *confident* about it — a thresholded crop against the
    card's watermark produces exactly this: fewer competing hypotheses, so a higher score for the
    wrong answer. Both candidates validate. Only the fact that two independent preprocessings
    agreed on the other one can decide it, and it has to outweigh the score.
    """
    settled = _combine((NEAR_MISS, 0.99), (VALID, 0.80), (VALID, 0.78))
    assert settled.value == VALID
    assert settled.agreement == "majority" and settled.support == 2


def test_a_lone_valid_read_is_kept_but_marked_as_such():
    settled = _combine((VALID, 0.9), ("123", 0.4))
    assert settled.value == VALID
    assert settled.agreement == "single" and settled.total == 1


# ── Voting, when nothing agrees outright ──


def test_reads_that_each_get_one_digit_wrong_are_voted_back_together():
    """No two reads are identical, yet every position has a clear majority.

    This is the case a "pick the best single read" rule cannot solve at all: each candidate is
    wrong somewhere, so whichever is chosen is wrong. Position-wise majority recovers a number that
    no variant produced and every variant supports.
    """
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
    reconstruction. Where both are available, the thing that was actually read wins."""
    settled = _combine((VALID, 0.7), (VALID, 0.7), (NEAR_MISS, 0.99), (NEAR_MISS, 0.99))
    assert settled.value in (VALID, NEAR_MISS)
    assert settled.agreement == "majority", "a reconstruction must not displace a real agreement"


# ── Refusing ──


def test_no_valid_reading_is_reported_as_invalid_rather_than_dressed_up():
    """The value still goes to the reviewer — with `valid` false, so nothing treats it as read."""
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
