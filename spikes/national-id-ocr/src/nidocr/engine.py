"""Recognizer implementations behind one protocol."""

from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from .preprocess import split_text_lines, trim_to_ink

LOG = logging.getLogger("nidocr.engine")

#: Text-detection model. Deliberately the mobile one.
#:
#: PaddleOCR's default for this language pairs a *server*-grade detector (`PP-OCRv5_server_det`)
#: with a *mobile* recognizer (`arabic_PP-OCRv5_mobile_rec`), the heaviest half of the pipeline
#: doing the easier half of the job. Detection here runs on a card that has already been located,
#: flattened and deskewed, so it is looking for a handful of well-separated horizontal lines on a
#: clean background. That is not what a server-grade detector is for, and its memory footprint is
#: what a container's ceiling is spent on.
#:
#: Settable so the pairing can be revisited against real measurements rather than by argument, and
#: read in both places that construct PaddleOCR, the runtime and the build-time bake, because a
#: model the image did not download is a model the offline container cannot load.
#:
#: Both models must be named together. PaddleOCR treats `lang` and explicit model names as mutually
#: exclusive: naming any one model discards `lang` entirely and every other model falls back to the
#: global default. Naming only the detector once swapped the Arabic recognizer
#: (`arabic_PP-OCRv5_mobile_rec`) for a generic one: the service kept running but could no longer
#: read Arabic. Only a build failure caught it:
#:
#:     UserWarning: `lang` and `ocr_version` will be ignored when model names ... are not `None`
#:     Creating model: ('PP-OCRv6_medium_rec', None, None)
#:
#: So this returns the pair, and callers spread it. `lang` is still passed for readability and is
#: ignored by PaddleOCR whenever these are set, which is exactly the behaviour being relied on.
DEFAULT_DETECTION_MODEL = "PP-OCRv5_mobile_det"
DEFAULT_RECOGNITION_MODEL = "arabic_PP-OCRv5_mobile_rec"


def model_names() -> dict[str, str]:
    """The detection/recognition pair PaddleOCR is constructed with, in both processes."""
    names = {
        "text_detection_model_name": os.environ.get("PADDLE_DET_MODEL", DEFAULT_DETECTION_MODEL),
        "text_recognition_model_name": os.environ.get(
            "PADDLE_REC_MODEL", DEFAULT_RECOGNITION_MODEL
        ),
    }
    # A recognition model from a folder (a community model under test), loaded offline from there.
    folder = os.environ.get("PADDLE_REC_MODEL_DIR", "").strip()
    if folder:
        names["text_recognition_model_dir"] = folder
    return names


def reading_order(text: str) -> str:
    """A line as read, in reading order. PADDLE_REC_VISUAL_ORDER=1: the recognition model returns
    right-to-left text in visual order (the community v6 Arabic model does), so it is turned around
    the way PaddleOCR turns its own Arabic models' output (bidi get_display). Unset: unchanged."""
    if os.environ.get("PADDLE_REC_VISUAL_ORDER", "").strip() != "1" or not text:
        return text
    from bidi.algorithm import get_display  # noqa: PLC0415 - PaddleX's own dependency

    return get_display(text)


def runtime_options() -> dict[str, object]:
    """Engine switches from the environment. PADDLE_ENABLE_MKLDNN=0 turns the oneDNN CPU path off:
    Paddle 3.3 rejects models exported for 3.0 on it. Unset, Paddle's own default."""
    if os.environ.get("PADDLE_ENABLE_MKLDNN", "").strip() == "0":
        return {"enable_mkldnn": False}
    return {}


@dataclass(frozen=True)
class LineRead:
    """One printed line as the recognizer returned it, before anything touches the string."""

    text: str
    score: float
    image: np.ndarray | None = None


@dataclass(frozen=True)
class Recognition:
    """One recognizer output: the text and the model's own score in [0, 1]."""

    text: str
    score: float
    #: The per-line reads the text was assembled from. Diagnostic; callers use `text`.
    lines: tuple[LineRead, ...] = ()


class Recognizer(Protocol):
    """Anything that turns an image crop into text plus a score."""

    id: str

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition: ...

    def detect_lines(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """Every text line on the image as (polygon, text, score), for calibration."""
        ...


class PaddleRecognizer:
    """PP-OCR via PaddleOCR 3.x, Arabic recognition, CPU, strictly offline."""

    id = "paddleocr-3.x"

    #: Detection always runs on a canvas of exactly this size, letterboxed.
    DETECT_CANVAS = (960, 640)

    #: Keep the strip images handed to the recognizer, so a trace can show them. Off in production
    #:, a card's worth of crops is memory spent on nobody's behalf when nobody is looking.
    keep_line_images = False

    def __init__(self, model_dir: str | None = None, lang: str = "ar") -> None:
        self._model_dir = model_dir or os.environ.get("PADDLE_OCR_MODEL_DIR", "/models")
        self._lock = threading.Lock()
        # Every Paddle predictor is built and called on this one thread, for the life of the
        # process. See `_call`.
        self._worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="paddle")
        self._worker.submit(self._load, lang).result()

    def _load(self, lang: str) -> None:
        # Point PaddleX's cache at the baked weights before importing paddleocr, the module reads
        # this at import time (paddlex/utils/cache.py).
        os.environ["PADDLE_PDX_CACHE_HOME"] = self._model_dir

        from paddleocr import PaddleOCR  # noqa: PLC0415 - lazy, and must follow the env set above

        # The three stages are disabled for the same reason they are not baked: crops come from a
        # card that preprocess.py has already rectified and deskewed, so orientation and unwarping
        # are pure latency.
        # A pool worker gets its share of the cores (pool.threads_per_worker); alone, Paddle's default.
        threads = os.environ.get("OCR_CPU_THREADS", "").strip()
        cpu = {"cpu_threads": int(threads)} if threads.isdigit() and int(threads) > 0 else {}
        self._ocr = PaddleOCR(
            lang=lang,
            **model_names(),
            **cpu,
            **runtime_options(),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

        # The recognition model on its own, for reading a field crop line by line.
        self._lines = None
        try:
            from paddleocr import TextRecognition  # noqa: PLC0415 - optional, guarded

            names = model_names()
            folder = {"model_dir": names["text_recognition_model_dir"]} if "text_recognition_model_dir" in names else {}
            self._lines = TextRecognition(
                model_name=names["text_recognition_model_name"], **folder, **cpu, **runtime_options()
            )
        except Exception:  # noqa: BLE001 - any failure here is a downgrade, not an outage
            LOG.warning(
                "standalone text recognition unavailable; field crops will go through detection, "
                "which can silently drop a word from the middle of a line",
                exc_info=True,
            )

    def _call(self, work):
        """Run `work` where the predictors live: on the one Paddle thread."""
        worker = getattr(self, "_worker", None)
        if worker is None:
            with self._lock:
                return work()
        return worker.submit(work).result()

    def _run(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """The one place the full pipeline is touched, on the Paddle thread. See `_call`."""
        return self._call(lambda: _flatten_paddle_polys(self._ocr.ocr(image)))

    def read_page(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """Every text line on an arbitrary page, at the page's own resolution, for `/read`."""
        return self._run(image)

    def detect_lines(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """Full-page detection + recognition, keeping each line's polygon."""
        # The same image is often asked twice in a row, the orientation check, then the row
        # reader measuring its tilt, so the last answer is kept for that one image.
        memo = getattr(self, "_detect_memo", None)
        if memo is not None and memo[0] is image:
            return memo[1]
        canvas_width, canvas_height = self.DETECT_CANVAS
        height, width = image.shape[:2]
        scale = min(canvas_width / width, canvas_height / height, 1.0)

        fitted_width = max(int(width * scale), 1)
        fitted_height = max(int(height * scale), 1)
        canvas = np.full((canvas_height, canvas_width, 3), 255, np.uint8)
        canvas[:fitted_height, :fitted_width] = cv2.resize(
            image, (fitted_width, fitted_height), interpolation=cv2.INTER_AREA
        )
        lines = [
            (np.asarray(poly, dtype=float) / scale, text, score)
            for poly, text, score in self._run(canvas)
        ]
        self._detect_memo = (image, lines)
        return lines

    def _read_lines(self, crop: np.ndarray) -> Recognition | None:
        """Recognize a field crop line by line, without running detection inside it."""
        if self._lines is None:
            return None
        strips = [trim_to_ink(strip) for strip in split_text_lines(crop)]
        predictions = self._call(lambda: [list(self._lines.predict(strip)) for strip in strips])
        reads: list[LineRead] = []
        for strip, entries in zip(strips, predictions):
            for entry in entries:
                text = reading_order(str(_field_of(entry, "rec_text", "")))
                if text.strip():
                    reads.append(
                        LineRead(
                            text=text,
                            score=float(_field_of(entry, "rec_score", 0.0)),
                            image=strip if self.keep_line_images else None,
                        )
                    )
        if not reads:
            return None
        # Strips come out top to bottom, which is reading order for every field on this card.
        return Recognition(
            text=" ".join(read.text for read in reads),
            score=float(np.mean([read.score for read in reads])),
            lines=tuple(reads),
        )

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:
        direct = self._read_lines(crop)
        if direct is not None:
            return direct

        segments = self._run(crop)
        if not segments:
            return Recognition(text="", score=0.0)
        ordered = _in_reading_order(segments, rtl=rtl)
        text = " ".join(text for text, _ in ordered)
        score = float(np.mean([score for _, score in ordered]))
        return Recognition(
            text=text,
            score=score,
            lines=tuple(LineRead(text=part, score=value) for part, value in ordered),
        )


def _field_of(entry: object, key: str, default: object) -> object:
    """Read a key from a PaddleX result, which is dict-like but not always a dict."""
    if isinstance(entry, dict):
        return entry.get(key, default)
    try:
        return entry[key]  # type: ignore[index]
    except (TypeError, KeyError, IndexError):
        return getattr(entry, key, default)


def _flatten_paddle_result(result: object) -> list[tuple[str, float]]:
    """Normalize PaddleOCR's nested output into [(text, score)]."""
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
                lines.append((reading_order(str(text)), float(score)))
        return lines

    # 2.x: list[page] of [box, (text, score)].
    for page in result:  # type: ignore[union-attr]
        if not page:
            continue
        for entry in page:
            try:
                text, score = entry[1]
                lines.append((reading_order(str(text)), float(score)))
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
    """Sort detected fragments into the order a person reads them."""
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
    """Like `_flatten_paddle_result`, but keeps each line's polygon."""
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
                lines.append((poly, reading_order(str(text)), float(score)))
        return lines

    # 2.x: list[page] of [box, (text, score)].
    for page in result:  # type: ignore[union-attr]
        if not page:
            continue
        for entry in page:
            try:
                poly = entry[0]
                text, score = entry[1]
                lines.append((poly, reading_order(str(text)), float(score)))
            except (IndexError, TypeError, ValueError):
                continue
    return lines


class MockRecognizer:
    """Replays known text per field, the pipeline harness without model weights."""

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
