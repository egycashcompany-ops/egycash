"""Accuracy metrics, how a read is judged against ground truth."""

from __future__ import annotations

from dataclasses import dataclass

from .arabic import normalize_arabic


def levenshtein(a: str, b: str) -> int:
    """Edit distance. Iterative two-row form, the strings here are short, but this runs per field per
    fixture and allocating a full matrix would be pointless.
    """
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    previous = list(range(len(b) + 1))
    for i, ch_a in enumerate(a, start=1):
        current = [i]
        for j, ch_b in enumerate(b, start=1):
            current.append(
                min(
                    previous[j] + 1,  # deletion
                    current[j - 1] + 1,  # insertion
                    previous[j - 1] + (ch_a != ch_b),  # substitution
                )
            )
        previous = current
    return previous[-1]


def character_error_rate(predicted: str, truth: str) -> float:
    """CER against the truth length. Empty truth with a non-empty read is a full error (1.0)."""
    if not truth:
        return 0.0 if not predicted else 1.0
    return levenshtein(predicted, truth) / len(truth)


@dataclass(frozen=True)
class FieldScore:
    field: str
    predicted: str
    truth: str
    exact: bool
    normalized: bool
    cer: float

    @property
    def missing(self) -> bool:
        """The pipeline returned nothing for a field that has a truth value."""
        return bool(self.truth) and not self.predicted


def score_field(field: str, predicted: str, truth: str) -> FieldScore:
    return FieldScore(
        field=field,
        predicted=predicted,
        truth=truth,
        exact=predicted == truth,
        normalized=normalize_arabic(predicted) == normalize_arabic(truth),
        cer=character_error_rate(predicted, truth),
    )


@dataclass
class FieldAggregate:
    """Per-field totals across a fixture set."""

    field: str
    total: int = 0
    exact: int = 0
    normalized: int = 0
    missing: int = 0
    cer_sum: float = 0.0

    def add(self, score: FieldScore) -> None:
        self.total += 1
        self.exact += int(score.exact)
        self.normalized += int(score.normalized)
        self.missing += int(score.missing)
        self.cer_sum += score.cer

    @property
    def exact_pct(self) -> float:
        return 100.0 * self.exact / self.total if self.total else 0.0

    @property
    def normalized_pct(self) -> float:
        return 100.0 * self.normalized / self.total if self.total else 0.0

    @property
    def mean_cer(self) -> float:
        return self.cer_sum / self.total if self.total else 0.0
