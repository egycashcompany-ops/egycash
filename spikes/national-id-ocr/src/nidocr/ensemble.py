"""Reading the number more than once, and deciding what several disagreeing reads mean.

THE PROBLEM THIS EXISTS FOR, STATED PRECISELY. A real card came back as 29208151202457 when it
printed 29208151203457 — one digit, ٢ read as ٣, at position eleven. Both strings are perfectly
valid national IDs: same century, same birth date, same governorate, differing only inside the
sequence. `is_structurally_valid` returns True for each, `parseNationalId` decodes each into a
consistent person, and every downstream check agrees. Validation cannot catch this error, and no
amount of making validation stricter will, because the information that would distinguish the two
numbers is not in the number.

It is in the PIXELS, and it is recoverable — but only by looking at them more than once. So the
number is read several times from the same crop under different preprocessing, and the reads are
combined. This works because the errors are largely independent: an adaptive threshold that breaks
٢ against the pyramid watermark does not break it the same way a plain greyscale read does, so the
variants that get it wrong tend to get it wrong differently while the variants that get it right
all agree. Majority at each position is then real evidence rather than a tie-break.

Two rules keep this honest:

  * **Agreement is reported, not just used.** A number four variants produced identically is a
    different thing from one assembled position-by-position out of reads that disagreed, and the
    caller bands them differently. Assembling a value nothing actually read is a deduction, and
    deductions do not get the top confidence band in this pipeline.
  * **Structure is a filter, never a source.** Where voting produces something that cannot be a
    national ID, a valid candidate is preferred over it. Where nothing valid exists, that is
    reported as such — the number still goes to the reviewer, at `low`, rather than being quietly
    presented as read.
"""

from __future__ import annotations

import datetime as _dt
from collections import Counter
from dataclasses import dataclass

from .nid import is_structurally_valid

#: Enough independent agreement to stop reading. Three variants landing on the same fourteen digits
#: is far stronger evidence than any single model score: they share the crop but not the
#: preprocessing, so a shared error has to survive a threshold, a histogram equalisation and a
#: plain greyscale read to reach all three.
ENOUGH_AGREEMENT = 3


@dataclass(frozen=True)
class Candidate:
    """One variant's reading of the field."""

    variant: str
    digits: str
    score: float


@dataclass(frozen=True)
class Consensus:
    """What several reads add up to, and how much they agreed."""

    value: str
    score: float
    #: 'unanimous' | 'majority' | 'voted' | 'single' | 'none'
    agreement: str
    #: How many variants produced exactly `value`. Zero when it came from position voting.
    support: int
    #: How many variants produced a fourteen-digit reading at all.
    total: int
    valid: bool

    @property
    def deduced(self) -> bool:
        """True when no single read produced this value — it was assembled from several."""
        return self.agreement == "voted"

    def as_diagnostics(self) -> dict[str, object]:
        """Counts only. Never the value — this goes into logs and API diagnostics."""
        return {"agreement": self.agreement, "support": self.support, "reads": self.total}


def _vote(candidates: list[Candidate]) -> str:
    """The digit each position was most often read as.

    Ties are broken by the highest-scoring candidate that voted for one of the tied digits, which
    is the only tie-break available that is not arbitrary: with two variants disagreeing and nothing
    else to separate them, the model's own confidence is the remaining evidence.
    """
    ordered = sorted(candidates, key=lambda item: item.score, reverse=True)
    digits = []
    for position in range(14):
        tally = Counter(candidate.digits[position] for candidate in ordered)
        best = max(tally.values())
        tied = {digit for digit, count in tally.items() if count == best}
        if len(tied) == 1:
            digits.append(tied.pop())
            continue
        digits.append(
            next(c.digits[position] for c in ordered if c.digits[position] in tied)
        )
    return "".join(digits)


def combine(
    candidates: list[Candidate], *, today: _dt.date | None = None
) -> Consensus | None:
    """Several readings of one number → the one to report, and how much to trust it.

    Returns None when no variant produced fourteen digits at all; the caller then falls back to
    whatever the single best read was, which is still worth showing a human.

    The preference order is deliberate. A value several variants produced independently beats one
    assembled from disagreeing reads, because agreement between independent reads is the strongest
    evidence anywhere in this pipeline — it is the same reasoning that makes the front and back of
    the card corroborate each other. Only where no agreed value can be a national ID does structure
    override agreement, and then the result is capped rather than trusted.
    """
    usable = [candidate for candidate in candidates if len(candidate.digits) == 14]
    if not usable:
        return None

    total = len(usable)
    tally = Counter(candidate.digits for candidate in usable)
    scored = {
        digits: max(c.score for c in usable if c.digits == digits) for digits in tally
    }
    mean_score = sum(c.score for c in usable) / total

    def _describe(value: str, support: int) -> Consensus:
        if support == total and total > 1:
            agreement = "unanimous"
        elif support > 1:
            agreement = "majority"
        elif support == 1:
            agreement = "single"
        else:
            agreement = "voted"
        return Consensus(
            value=value,
            # A value nothing read outright does not inherit the best read's score. The mean is
            # what the evidence actually was: several reads, none of them this.
            score=scored.get(value, mean_score),
            agreement=agreement,
            support=support,
            total=total,
            valid=is_structurally_valid(value, today=today),
        )

    # Most-agreed first, then by the model's own confidence — so a two-way split at one read each
    # is settled by the score rather than by dictionary order.
    ranked = sorted(tally.items(), key=lambda item: (item[1], scored[item[0]]), reverse=True)

    # 1. Several variants read the same valid number. Independent agreement is the strongest
    #    evidence available here, and it is what actually fixes the reported fault: the variant
    #    that turned ٢ into ٣ is outvoted by the ones that did not.
    agreed = [
        (digits, count)
        for digits, count in ranked
        if count > 1 and is_structurally_valid(digits, today=today)
    ]
    if agreed:
        return _describe(*agreed[0])

    # 2. No two variants agreed outright — but they may still agree position by position. Reads
    #    that differ in one digit each still have a clear majority at every other digit, and taking
    #    the majority per position recovers a number no single read got entirely right.
    voted = _vote(usable)
    if is_structurally_valid(voted, today=today):
        return _describe(voted, tally.get(voted, 0))

    # 3. Voting produced nothing usable. A single variant's valid reading is thin evidence, but it
    #    is evidence, and it beats reporting a string that cannot be a national ID.
    for digits, count in ranked:
        if is_structurally_valid(digits, today=today):
            return _describe(digits, count)

    # 4. No valid reading and no valid combination. Report the most-agreed one so the reviewer has
    #    something to correct, flagged invalid so nothing downstream treats it as read.
    return _describe(*ranked[0])
