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

    def detect_lines(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """Every text line on the image as (polygon, text, score) — for calibration.

        Distinct from `recognize`, which is handed a crop the field boxes already chose. This
        looks at the whole card and reports what is on it, which is the only way to find out
        where the boxes *should* be rather than what they happened to catch.
        """
        ...


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
        self._model_dir = model_dir or os.environ.get("PADDLE_OCR_MODEL_DIR", "/models")
        # Point PaddleX's cache at the baked weights BEFORE importing paddleocr — the module reads
        # this at import time (paddlex/utils/cache.py). With the weights already present, model
        # resolution is a local lookup and nothing is fetched, which is what makes the container
        # offline by construction rather than by firewall.
        os.environ["PADDLE_PDX_CACHE_HOME"] = self._model_dir

        from paddleocr import PaddleOCR  # noqa: PLC0415 — lazy, and must follow the env set above

        # The three stages are disabled for the same reason they are not baked: crops come from a
        # card that preprocess.py has already rectified and deskewed, so orientation and unwarping
        # are pure latency. Model directories are deliberately NOT passed — PaddleOCR resolves
        # them from the cache above, and hand-built paths would have to mirror PaddleX's internal
        # layout, which is not a contract this spike should depend on.
        self._ocr = PaddleOCR(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def detect_lines(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """Full-page detection + recognition, keeping each line's polygon."""
        return _flatten_paddle_polys(self._ocr.ocr(image))

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


def _flatten_paddle_polys(result: object) -> list[tuple[object, str, float]]:
    """Like `_flatten_paddle_result`, but keeps each line's polygon.

    Parsed just as defensively and for the same reason: PaddleOCR moved the polygon key between
    releases (`dt_polys` / `rec_polys`), and a silent miss here would report a card with no text
    on it — which reads as "the card is blank" rather than "the key was renamed".
    """
    lines: list[tuple[object, str, float]] = []
    if not result:
        return lines

    first = result[0] if isinstance(result, (list, tuple)) and result else None
    if isinstance(first, dict):
        for page in result:  # type: ignore[union-attr]
            texts = page.get("rec_texts") or []
            scores = page.get("rec_scores") or []
            polys = page.get("rec_polys")
            if polys is None or len(polys) == 0:
                polys = page.get("dt_polys") or []
            for poly, text, score in zip(polys, texts, scores):
                lines.append((poly, str(text), float(score)))
        return lines

    # 2.x: list[page] of [box, (text, score)].
    for page in result:  # type: ignore[union-attr]
        if not page:
            continue
        for entry in page:
            try:
                poly = entry[0]
                text, score = entry[1]
                lines.append((poly, str(text), float(score)))
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

    def __init__(
        self,
        values: dict[str, str],
        score: float = 0.97,
        lines: list[tuple[object, str, float]] | None = None,
    ) -> None:
        self._values = values
        self._score = score
        self._current: str | None = None
        #: Replayed by `detect_lines`, so the diagnose path is exercisable without weights.
        self._lines = lines or []

    def detect_lines(self, image: np.ndarray) -> list[tuple[object, str, float]]:  # noqa: ARG002
        return list(self._lines)

    def bind(self, field_name: str) -> None:
        self._current = field_name

    def recognize(self, crop: np.ndarray) -> Recognition:  # noqa: ARG002 — crop unused by design
        if self._current is None or self._current not in self._values:
            return Recognition(text="", score=0.0)
        return Recognition(text=self._values[self._current], score=self._score)
