"""Reading the number more than once, and deciding what several disagreeing reads mean."""

from __future__ import annotations

import datetime as _dt
from collections import Counter
from dataclasses import dataclass, replace

from .nid import is_structurally_valid

#: Enough independent agreement to stop reading.
ENOUGH_AGREEMENT = 3

#: A partial read shorter than this says too little to back or contradict a number: eight digits
#: fit inside almost any two numbers that share a birth date.
MIN_BACKING_DIGITS = 8
#: A partial read is completed from a full one only when it lost at most four digits.
MIN_SPLICE_DIGITS = 10


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
    #: How much more of the evidence separating this value from its closest rival backs it (see
    #: `_separating`). Infinite when nothing that separates them backs the rival.
    margin: float = float("inf")
    #: How many separate sources (filters, per side) read digits that fit this value, partial
    #: reads included (see `backing`). Zero when it was not measured.
    sources: int = 0

    @property
    def deduced(self) -> bool:
        """True when no single read produced this value outright, or it beat the outright reads."""
        return self.agreement in ("voted", "backed")

    def as_diagnostics(self) -> dict[str, object]:
        """Counts only. Never the value, this goes into logs and API diagnostics."""
        return {"agreement": self.agreement, "support": self.support, "reads": self.total}


def _vote(candidates: list[Candidate]) -> str:
    """The digit each position was most often read as."""
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


def _source(variant: str) -> str:
    """The preprocessing a read came from: 'front:widened2:grey' and 'front:grey' are one source.
    """
    return ":".join(part for part in variant.split(":") if not part.startswith("widened"))


def fits_inside(digits: str, value: str) -> bool:
    """Whether `digits` is `value` with some digits lost, read in order, nothing added."""
    return _within(digits, value)


def _within(digits: str, value: str) -> bool:
    """Whether `digits` is `value` with some digits lost, read in order, nothing added."""
    remaining = iter(value)
    return all(digit in remaining for digit in digits)


def _backers(candidates: list[Candidate], value: str) -> dict[str, float]:
    """Each source whose reads fit inside `value`, at its best score."""
    best: dict[str, float] = {}
    for candidate in candidates:
        digits = candidate.digits
        if MIN_BACKING_DIGITS <= len(digits) <= 14 and _within(digits, value):
            key = _source(candidate.variant)
            best[key] = max(best.get(key, 0.0), candidate.score)
    return best


def backers(candidates: list[Candidate], value: str) -> dict[str, float]:
    """The sources whose reads fit inside `value`, each at its best score (see `backing`)."""
    return _backers(candidates, value)


def backing(candidates: list[Candidate], value: str) -> float:
    """How much of what was read supports `value`, counting partial reads too."""
    return sum(_backers(candidates, value).values())


def _separating(mine: dict[str, float], theirs: dict[str, float]) -> float:
    """How much more of the evidence that tells two numbers apart backs the first one."""
    only_mine = sum(score for source, score in mine.items() if source not in theirs)
    only_theirs = sum(score for source, score in theirs.items() if source not in mine)
    if only_theirs == 0:
        return float("inf") if only_mine > 0 else 1.0
    return only_mine / only_theirs


def _spliced(candidates: list[Candidate]) -> set[str]:
    """Partial reads completed with the digits a full read has where the partial lost them."""
    full = {c.digits for c in candidates if len(c.digits) == 14}
    out: set[str] = set()
    for candidate in candidates:
        digits = candidate.digits
        if not MIN_SPLICE_DIGITS <= len(digits) < 14:
            continue
        for value in full:
            out.add(value[: 14 - len(digits)] + digits)
            out.add(digits + value[len(digits) :])
    return out


def combine(
    candidates: list[Candidate], *, today: _dt.date | None = None
) -> Consensus | None:
    """Several readings of one number → the one to report, and how much to trust it."""
    chosen = _counted(candidates, today=today)
    if chosen is None:
        return None
    return _backed(candidates, chosen, today=today)


def _backed(
    candidates: list[Candidate], chosen: Consensus, *, today: _dt.date | None
) -> Consensus:
    """`chosen`, unless another valid number is backed by more of the reads, partial ones included.
    """
    contenders = {
        value
        for value in {c.digits for c in candidates if len(c.digits) == 14} | _spliced(candidates)
        if is_structurally_valid(value, today=today)
    }
    if chosen.valid:
        contenders.add(chosen.value)
    if not contenders:
        return chosen
    backers = {value: _backers(candidates, value) for value in contenders}
    weight = {value: sum(found.values()) for value, found in backers.items()}
    best = max(contenders, key=lambda value: (weight[value], value == chosen.value))
    margin = min(
        (_separating(backers[best], backers[value]) for value in contenders if value != best),
        default=float("inf"),
    )
    # One source alone never overrules the count: reads that each got a different digit wrong are
    # each backed by themselves only, and the position vote that rebuilt the true number from them
    # is backed by none, that vote stands.
    if best == chosen.value or len(backers[best]) < 2:
        if best == chosen.value:
            return replace(chosen, margin=margin, sources=len(backers[best]))
        return chosen
    support = sum(c.digits == best for c in candidates)
    return Consensus(
        value=best,
        score=max((c.score for c in candidates if c.digits == best), default=chosen.score),
        agreement="backed",
        support=support,
        total=chosen.total,
        valid=True,
        margin=margin,
        sources=len(backers[best]),
    )


def _counted(
    candidates: list[Candidate], *, today: _dt.date | None = None
) -> Consensus | None:
    """Several readings of one number → the one to report, and how much to trust it."""
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

    # Most-agreed first, then by the model's own confidence, so a two-way split at one read each
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

    # 2. No two variants agreed outright, but they may still agree position by position. Reads
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
