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

import logging
import os
import threading
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from .preprocess import split_text_lines

LOG = logging.getLogger("nidocr.engine")

#: Text-detection model. Deliberately the MOBILE one.
#:
#: PaddleOCR's default for this language pairs a *server*-grade detector (`PP-OCRv5_server_det`)
#: with a *mobile* recognizer (`arabic_PP-OCRv5_mobile_rec`) — the heaviest half of the pipeline
#: doing the easier half of the job. Detection here runs on a card that has already been located,
#: flattened and deskewed, so it is looking for a handful of well-separated horizontal lines on a
#: clean background. That is not what a server-grade detector is for, and its memory footprint is
#: what a container's ceiling is spent on.
#:
#: Settable so the pairing can be revisited against real measurements rather than by argument, and
#: read in both places that construct PaddleOCR — the runtime and the build-time bake — because a
#: model the image did not download is a model the offline container cannot load.
#:
#: BOTH MODELS MUST BE NAMED TOGETHER. PaddleOCR treats `lang` and explicit model names as mutually
#: exclusive: naming any one model discards `lang` entirely and every other model falls back to the
#: global default. Naming only the detector therefore swapped the Arabic recognizer
#: (`arabic_PP-OCRv5_mobile_rec`) for a generic one, which is a silent catastrophe — the pipeline
#: would have kept running and stopped being able to read Arabic at all. It happened to also fail
#: the build, which is the only reason it was caught before deployment:
#:
#:     UserWarning: `lang` and `ocr_version` will be ignored when model names ... are not `None`
#:     Creating model: ('PP-OCRv6_medium_rec', None, None)
#:
#: So this returns the pair, and callers spread it. `lang` is still passed for readability and is
#: ignored by PaddleOCR whenever these are set — which is exactly the behaviour being relied on.
DEFAULT_DETECTION_MODEL = "PP-OCRv5_mobile_det"
DEFAULT_RECOGNITION_MODEL = "arabic_PP-OCRv5_mobile_rec"


def model_names() -> dict[str, str]:
    """The detection/recognition pair PaddleOCR is constructed with, in both processes."""
    return {
        "text_detection_model_name": os.environ.get("PADDLE_DET_MODEL", DEFAULT_DETECTION_MODEL),
        "text_recognition_model_name": os.environ.get(
            "PADDLE_REC_MODEL", DEFAULT_RECOGNITION_MODEL
        ),
    }


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

    **Every call into the predictor is serialized.** PaddleOCR's static predictor holds native
    inference state and is not safe to call from two threads at once; the service is a
    `ThreadingHTTPServer` sharing one recognizer across every request. Two overlapping scans
    therefore entered `predictor.run()` together and the process raised `RuntimeError:
    std::exception` from inside C++ — a crash with no Python-level cause to find, which is why the
    tracebacks pointed at paddle and told you nothing.

    That is not a hypothetical read of the logs. The tracebacks themselves came out interleaved,
    two threads writing stderr line-by-line into each other, which is direct evidence that two
    requests were inside the recognizer simultaneously.

    Serializing costs throughput and nothing else here: `OMP_NUM_THREADS=1` already pins the model
    to one core, so concurrent requests were never actually computing in parallel — they were
    contending for one core AND corrupting each other's inference state.
    """

    id = "paddleocr-3.x"

    #: Detection always runs on a canvas of exactly this size, letterboxed. Both dimensions are
    #: multiples of 32, which is what the detection model's own preprocessing wants.
    #:
    #: A CONSTANT shape is the point, not the size. Paddle's static predictor allocates its
    #: inference workspace for the shape it is given, and re-allocates when that shape changes.
    #: This pipeline alternates between a full card and a series of differently-sized field crops,
    #: so every call was a new shape and every call re-allocated — and under a container's memory
    #: ceiling a re-allocation that cannot be satisfied surfaces as `RuntimeError: std::exception`
    #: from inside C++, with no Python-level cause to find. Serializing the calls did not fix it,
    #: which is what ruled out the first (thread-safety) explanation.
    #:
    #: Letterboxing rather than stretching: the card's proportions have to survive, because the
    #: polygons that come back are scaled straight into field boxes.
    DETECT_CANVAS = (960, 640)

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
            **model_names(),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
        self._lock = threading.Lock()

        # The recognition model on its own, for reading a field crop line by line. See
        # `_read_lines`: running detection inside a crop that a field box already located is how a
        # name lost three of its six words, so the field path skips detection entirely.
        #
        # Constructed defensively. It is the same weights the pipeline above already resolved, so
        # nothing extra is downloaded — but the standalone module classes are a newer part of
        # PaddleOCR's API than `PaddleOCR` itself, and a version that lacks them must degrade to
        # the pipeline rather than fail to start.
        self._lines = None
        try:
            from paddleocr import TextRecognition  # noqa: PLC0415 — optional, guarded

            self._lines = TextRecognition(
                model_name=model_names()["text_recognition_model_name"]
            )
        except Exception:  # noqa: BLE001 — any failure here is a downgrade, not an outage
            LOG.warning(
                "standalone text recognition unavailable; field crops will go through detection, "
                "which can silently drop a word from the middle of a line",
                exc_info=True,
            )

    def _run(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """The one place the predictor is touched, under the one lock. See the class docstring."""
        with self._lock:
            return _flatten_paddle_polys(self._ocr.ocr(image))

    def detect_lines(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        """Full-page detection + recognition, keeping each line's polygon.

        The card is letterboxed onto a fixed canvas and the polygons are scaled back, so the
        contract is unchanged: coordinates come back in the caller's pixel space. Callers use these
        to place crops, and a box is a coordinate rather than a glyph, so the precision lost to the
        resize is absorbed by `anchor._pad`.

        Placed at the origin so the inverse is a division and nothing else. An offset here would be
        wrong in a way that looks exactly like a mis-calibrated profile.
        """
        canvas_width, canvas_height = self.DETECT_CANVAS
        height, width = image.shape[:2]
        scale = min(canvas_width / width, canvas_height / height, 1.0)

        fitted_width = max(int(width * scale), 1)
        fitted_height = max(int(height * scale), 1)
        canvas = np.full((canvas_height, canvas_width, 3), 255, np.uint8)
        canvas[:fitted_height, :fitted_width] = cv2.resize(
            image, (fitted_width, fitted_height), interpolation=cv2.INTER_AREA
        )
        return [
            (np.asarray(poly, dtype=float) / scale, text, score)
            for poly, text, score in self._run(canvas)
        ]

    def _read_lines(self, crop: np.ndarray) -> Recognition | None:
        """Recognize a field crop line by line, WITHOUT running detection inside it.

        This is the path that matters for a field box, and the reason is a failure that hides
        completely. Handing a crop to the full pipeline runs text detection on it, and detection
        returns the words it is confident about — so a word it is not confident about simply is not
        in the result. The field then arrives missing a word from the MIDDLE of a line, with every
        word around it correct, correctly read and correctly ordered. Nothing downstream can tell:
        there is no low score to notice, no gap in the string, no structural check that fires. A
        card printing a six-part name came back with three of them — the first, the third and the
        last were gone.

        Detection is the wrong tool at this point anyway. Its job is to find text on a page; this
        crop was already located, because the field box is where the text is. All that remains is
        cutting the crop into printed lines, which `preprocess.split_text_lines` does from the ink
        profile, and then reading each line whole.

        Returns None when the recognition model could not be constructed, so the caller can fall
        back to the pipeline rather than lose the field.
        """
        if self._lines is None:
            return None
        strips = split_text_lines(crop)
        reads: list[tuple[str, float]] = []
        with self._lock:
            for strip in strips:
                for entry in self._lines.predict(strip):
                    text = str(_field_of(entry, "rec_text", ""))
                    if text.strip():
                        reads.append((text, float(_field_of(entry, "rec_score", 0.0))))
        if not reads:
            return None
        # Strips come out top to bottom, which is reading order for every field on this card. No
        # re-ordering happens here at all: each strip is one line, read whole by a model that
        # already emits Arabic in logical order, so there are no fragments to sequence and no
        # opportunity to sequence them wrongly.
        return Recognition(
            text=" ".join(text for text, _ in reads),
            score=float(np.mean([score for _, score in reads])),
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
        return Recognition(text=text, score=score)


def _field_of(entry: object, key: str, default: object) -> object:
    """Read a key from a PaddleX result, which is dict-like but not always a dict."""
    if isinstance(entry, dict):
        return entry.get(key, default)
    try:
        return entry[key]  # type: ignore[index]
    except (TypeError, KeyError, IndexError):
        return getattr(entry, key, default)


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
