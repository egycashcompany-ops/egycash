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

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition: ...

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

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:
        segments = _flatten_paddle_polys(self._ocr.ocr(crop))
        if not segments:
            return Recognition(text="", score=0.0)
        ordered = _in_reading_order(segments, rtl=rtl)
        text = " ".join(text for text, _ in ordered)
        score = float(np.mean([score for _, score in ordered]))
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


def _bounds(poly: object) -> tuple[float, float, float, float]:
    """(left, top, right, bottom) of a detection polygon, or zeros if it cannot be read."""
    try:
        points = np.asarray(poly, dtype=float).reshape(-1, 2)
    except (TypeError, ValueError):
        return 0.0, 0.0, 0.0, 0.0
    if points.size == 0:
        return 0.0, 0.0, 0.0, 0.0
    return (
        float(points[:, 0].min()),
        float(points[:, 1].min()),
        float(points[:, 0].max()),
        float(points[:, 1].max()),
    )


def _in_reading_order(
    segments: list[tuple[object, str, float]], *, rtl: bool
) -> list[tuple[str, float]]:
    """Sort detected fragments into the order a person reads them.

    Detection returns fragments in its own order, which is not reading order. Joining them as they
    arrive is why a name came back as its own words shuffled — every word correct, the sequence
    meaningless, and a reviewer forced to retype a field the model actually got right.

    Fragments are grouped into rows by vertical overlap rather than by exact y, because two words
    on the same printed line rarely share a baseline pixel-for-pixel. Rows then run top to bottom,
    and within a row:

      * `rtl=True`  — rightmost first. Arabic names and addresses read from the right.
      * `rtl=False` — leftmost first. The national ID is a NUMBER: the card prints it in spaced
        groups, and those groups read left to right regardless of the script around them.
        Ordering digit groups right-to-left would reverse the number while leaving every digit
        correct, which is the worst possible failure for this field — it looks plausible.
    """
    if not segments:
        return []

    boxed = [(_bounds(poly), text, score) for poly, text, score in segments]
    heights = [bottom - top for (_, top, _, bottom), _, _ in boxed if bottom > top]
    # Half the median glyph height is a forgiving row tolerance: wide enough to absorb baseline
    # jitter, narrow enough that two printed lines never merge into one row.
    tolerance = (float(np.median(heights)) / 2.0) if heights else 0.0

    rows: list[list[tuple[tuple[float, float, float, float], str, float]]] = []
    for item in sorted(boxed, key=lambda entry: entry[0][1]):
        (_, top, _, bottom) = item[0]
        centre = (top + bottom) / 2.0
        for row in rows:
            row_centres = [(b[1] + b[3]) / 2.0 for b, _, _ in row]
            if abs(centre - float(np.mean(row_centres))) <= tolerance:
                row.append(item)
                break
        else:
            rows.append([item])

    ordered: list[tuple[str, float]] = []
    for row in rows:
        # Key on the leading edge for the direction being read.
        row.sort(key=lambda entry: entry[0][2] if rtl else entry[0][0], reverse=rtl)
        ordered.extend((text, score) for _, text, score in row)
    return ordered


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

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:  # noqa: ARG002
        if self._current is None or self._current not in self._values:
            return Recognition(text="", score=0.0)
        return Recognition(text=self._values[self._current], score=self._score)
