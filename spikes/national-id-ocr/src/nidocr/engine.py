"""Recognizer implementations behind one protocol.

The protocol exists for the same reason `NationalIdOcrProvider` exists on the TypeScript side: the
recognizer is the part most likely to be swapped. If PaddleOCR's Arabic accuracy turns out to be
insufficient — which is precisely what this spike is built to find out — a vision-language model
drops in here and nothing else in the pipeline changes.

`MockRecognizer` is not test scaffolding for its own sake. It lets the ENTIRE pipeline (rectify →
deskew → crop → post-process → score) be exercised and regression-tested with no model weights and
no network, which is what makes this spike runnable in CI and in restricted environments. Only the
recognition step itself needs the real model.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class Recognition:
    """One recognizer output: the text and the model's own score in [0, 1]."""

    text: str
    score: float


class Recognizer(Protocol):
    """Anything that turns an image crop into text plus a score."""

    id: str

    def recognize(self, crop: np.ndarray) -> Recognition: ...


class PaddleRecognizer:
    """PP-OCR via PaddleOCR 3.x, Arabic recognition, CPU, strictly offline.

    Offline is enforced, not hoped for: `PADDLE_OCR_MODEL_DIR` points at weights baked into the
    image at build time, and PaddleOCR is constructed with those paths so it never reaches for a
    download at runtime. A production container that phones home on first request is not an
    offline deployment — it is one firewall rule away from a silent outage.

    Import is lazy so that the rest of the package — preprocessing, layout, scoring, the whole
    Mock path — imports and runs without paddle installed.
    """

    id = "paddleocr-3.x"

    def __init__(self, model_dir: str | None = None, lang: str = "ar") -> None:
        from paddleocr import PaddleOCR  # noqa: PLC0415 — intentionally lazy

        self._model_dir = model_dir or os.environ.get("PADDLE_OCR_MODEL_DIR", "/models")
        # `use_textline_orientation=False`: crops come from a rectified, deskewed card and are
        # already upright, so the orientation classifier is pure latency here.
        self._ocr = PaddleOCR(
            lang=lang,
            use_textline_orientation=False,
            det_model_dir=os.path.join(self._model_dir, "det"),
            rec_model_dir=os.path.join(self._model_dir, "rec"),
            cls_model_dir=os.path.join(self._model_dir, "cls"),
            show_log=False,
        )

    def recognize(self, crop: np.ndarray) -> Recognition:
        result = self._ocr.ocr(crop)
        lines = _flatten_paddle_result(result)
        if not lines:
            return Recognition(text="", score=0.0)
        # A field box may legitimately hold two printed lines (the name chain, the address).
        # Join in reading order; the mean score is the field's score.
        text = " ".join(text for text, _ in lines)
        score = float(np.mean([score for _, score in lines]))
        return Recognition(text=text, score=score)


def _flatten_paddle_result(result: object) -> list[tuple[str, float]]:
    """Normalize PaddleOCR's nested output into [(text, score)].

    PaddleOCR's return shape has changed across 2.x/3.x releases (and between the `ocr()` and
    `predict()` entry points). Parsing defensively here keeps a minor version bump from silently
    yielding zero fields — which would look like an accuracy collapse rather than a shape change.
    """
    lines: list[tuple[str, float]] = []
    if not result:
        return lines

    # 3.x: list[dict] with parallel rec_texts / rec_scores arrays.
    first = result[0] if isinstance(result, (list, tuple)) and result else None
    if isinstance(first, dict):
        for page in result:  # type: ignore[union-attr]
            texts = page.get("rec_texts") or []
            scores = page.get("rec_scores") or []
            for text, score in zip(texts, scores):
                lines.append((str(text), float(score)))
        return lines

    # 2.x: list[page] of [box, (text, score)].
    for page in result:  # type: ignore[union-attr]
        if not page:
            continue
        for entry in page:
            try:
                text, score = entry[1]
                lines.append((str(text), float(score)))
            except (IndexError, TypeError, ValueError):
                continue
    return lines


class MockRecognizer:
    """Replays known text per field — the pipeline harness without model weights.

    Takes a `{field_name: text}` map and is driven by `extract` through the field name, so the
    crops are still produced by the real preprocessing chain and the real geometry. What it
    validates is everything except recognition: that rectification lands, that boxes map to the
    right fields, that post-processing and scoring behave.
    """

    id = "mock"

    def __init__(self, values: dict[str, str], score: float = 0.97) -> None:
        self._values = values
        self._score = score
        self._current: str | None = None

    def bind(self, field_name: str) -> None:
        self._current = field_name

    def recognize(self, crop: np.ndarray) -> Recognition:  # noqa: ARG002 — crop unused by design
        if self._current is None or self._current not in self._values:
            return Recognition(text="", score=0.0)
        return Recognition(text=self._values[self._current], score=self._score)
