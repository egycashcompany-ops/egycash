"""The call into PaddleOCR — pinned without paddle installed.

This file exists because of a real failure. The first production build of the image died in
`bake_models.py`, and fixing that surfaced a second defect the build could never have caught:
`PaddleRecognizer` passed `show_log=False`, which PaddleOCR 2.x accepted and 3.x rejects outright
(`paddleocr/_common_args.py`: `raise ValueError(f"Unknown argument: {name}")`). Nothing here is
exercised by the pipeline tests — they all run on `MockRecognizer` — so the error would have
waited until the first recruiter scanned a card, and surfaced as "OCR failed" rather than as a
parameter that stopped existing between two major versions.

Recognition itself still needs weights and a machine with paddle installed. What is checkable
without either is the *call*: which keyword arguments cross the boundary, and whether the model
cache is pointed at the baked weights before the import that reads it. Both are pinned by
injecting a stand-in `paddleocr` module, so these run anywhere the rest of the suite runs.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

#: Every keyword `PaddleOCR.__init__` accepts in 3.x, read from the installed
#: `paddleocr/_pipelines/ocr.py` for the version pinned in requirements.txt. Anything outside this
#: set reaches `parse_common_args`, which raises rather than ignoring it.
V3_INIT_PARAMS = frozenset(
    {
        "doc_orientation_classify_model_name",
        "doc_orientation_classify_model_dir",
        "doc_unwarping_model_name",
        "doc_unwarping_model_dir",
        "text_detection_model_name",
        "text_detection_model_dir",
        "textline_orientation_model_name",
        "textline_orientation_model_dir",
        "textline_orientation_batch_size",
        "text_recognition_model_name",
        "text_recognition_model_dir",
        "text_recognition_batch_size",
        "use_doc_orientation_classify",
        "use_doc_unwarping",
        "use_textline_orientation",
        "text_det_limit_side_len",
        "text_det_limit_type",
        "text_det_thresh",
        "text_det_box_thresh",
        "text_det_unclip_ratio",
        "text_det_input_shape",
        "text_rec_score_thresh",
        "return_word_box",
        "text_rec_input_shape",
        "lang",
        "ocr_version",
    }
)

#: Removed in 3.x with no alias — passing any of these raises at construction.
REMOVED_IN_V3 = frozenset({"show_log", "use_gpu", "enable_mkldnn_", "max_text_length"})


@pytest.fixture()
def captured_kwargs(monkeypatch, tmp_path):
    """Build the recognizer against a stand-in paddleocr and return what it passed."""
    captured: dict[str, object] = {}

    class FakePaddleOCR:
        def __init__(self, **kwargs) -> None:
            captured.update(kwargs)

    fake = types.ModuleType("paddleocr")
    fake.PaddleOCR = FakePaddleOCR  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "paddleocr", fake)
    # Pre-set so monkeypatch restores it — the recognizer writes this key directly.
    monkeypatch.setenv("PADDLE_PDX_CACHE_HOME", "sentinel-should-be-overwritten")

    from nidocr.engine import PaddleRecognizer  # noqa: PLC0415 — after the module is patched in

    PaddleRecognizer(model_dir=str(tmp_path))
    return captured, str(tmp_path)


def test_only_passes_keywords_that_exist_in_paddleocr_3x(captured_kwargs):
    """The regression: `show_log` was accepted by 2.x and raises in 3.x."""
    captured, _ = captured_kwargs
    unknown = set(captured) - V3_INIT_PARAMS
    assert not unknown, f"PaddleOCR 3.x rejects these at construction: {sorted(unknown)}"


def test_passes_no_keyword_removed_in_3x(captured_kwargs):
    captured, _ = captured_kwargs
    assert not set(captured) & REMOVED_IN_V3


def test_optional_stages_are_disabled(captured_kwargs):
    """All three off — the card is already rectified, and each one costs a model download."""
    captured, _ = captured_kwargs
    for flag in ("use_doc_orientation_classify", "use_doc_unwarping", "use_textline_orientation"):
        assert captured.get(flag) is False, f"{flag} should be explicitly False"


def test_model_cache_is_pointed_at_the_baked_weights(captured_kwargs):
    """PaddleX reads PADDLE_PDX_CACHE_HOME, not PADDLE_HOME — getting this wrong is what made the
    first image build fail, with the weights downloaded into a directory nothing copied."""
    _, model_dir = captured_kwargs
    assert os.environ["PADDLE_PDX_CACHE_HOME"] == model_dir


def test_model_directories_are_left_to_cache_resolution(captured_kwargs):
    """Hand-built paths would have to mirror PaddleX's internal cache layout, which is not a
    contract worth depending on — the previous code guessed `<dir>/det` and `<dir>/rec`."""
    captured, _ = captured_kwargs
    assert not [k for k in captured if k.endswith("_model_dir")]


# ── Detection input shape ──


def test_detection_letterboxes_to_a_constant_canvas_and_maps_polygons_back():
    """Paddle re-allocates its workspace whenever the input shape changes.

    Alternating a full card with differently-sized field crops made every call a new shape, and a
    re-allocation that a container's memory ceiling cannot satisfy surfaces as `RuntimeError:
    std::exception` from inside C++ — with no Python-level cause to find. Serializing the calls did
    not stop it, which is what ruled out thread-safety as the explanation.

    A constant canvas is the fix, so the two properties worth pinning are that the shape really is
    constant whatever comes in, and that the polygons still come back in the CALLER's coordinates —
    a scaling bug here would look exactly like a mis-calibrated profile.
    """
    import numpy as np

    from nidocr.engine import PaddleRecognizer

    seen: list[tuple[int, int]] = []

    class _Recorder(PaddleRecognizer):
        def __init__(self):  # noqa: D107 — deliberately skips PaddleOCR construction
            pass

        def _run(self, image):
            seen.append(image.shape[:2])
            # One box spanning the whole canvas, so the inverse mapping is checkable by eye.
            width, height = self.DETECT_CANVAS
            return [([[0, 0], [width, 0], [width, height], [0, height]], "نص", 0.9)]

    recorder = _Recorder()
    canvas_width, canvas_height = recorder.DETECT_CANVAS
    assert canvas_width % 32 == 0 and canvas_height % 32 == 0, "the detector wants multiples of 32"

    for shape in ((646, 1024, 3), (400, 400, 3), (200, 1600, 3)):
        recorder.detect_lines(np.full(shape, 220, np.uint8))

    assert seen == [(canvas_height, canvas_width)] * 3, "the detection input shape must not vary"

    # A 1024-wide card is scaled by 960/1024; the returned polygon must undo exactly that.
    polygons = recorder.detect_lines(np.full((646, 1024, 3), 220, np.uint8))
    scale = min(canvas_width / 1024, canvas_height / 646, 1.0)
    assert abs(polygons[0][0][2][0] - canvas_width / scale) < 1.0


# ── The model pair ──


def test_the_bake_script_and_the_runtime_name_the_same_models():
    """A model the build never downloaded is one the offline container cannot load.

    The two are separate processes and the builder stage deliberately copies only the bake script,
    not `src/` — weights have no business being fetched by a layer that also carries application
    code. So the defaults are duplicated, and this asserts they have not drifted, which is the
    failure that would otherwise surface as a container starting cleanly and dying on the first
    real request.
    """
    import re

    from nidocr.engine import DEFAULT_DETECTION_MODEL, DEFAULT_RECOGNITION_MODEL

    script = (ROOT / "scripts" / "bake_models.py").read_text(encoding="utf-8")
    for variable, expected in (
        ("PADDLE_DET_MODEL", DEFAULT_DETECTION_MODEL),
        ("PADDLE_REC_MODEL", DEFAULT_RECOGNITION_MODEL),
    ):
        found = re.search(rf'os\.environ\.get\("{variable}",\s*"([^"]+)"\)', script)
        assert found, f"{variable} is not read by the bake script"
        assert found.group(1) == expected, (
            f"{variable}: bake script says {found.group(1)!r}, runtime says {expected!r}"
        )


def test_both_models_are_always_named_together():
    """Naming one model makes PaddleOCR discard `lang`, and the rest fall back to global defaults.

    That is not a theoretical hazard. Naming only the detector silently swapped the Arabic
    recognizer for `PP-OCRv6_medium_rec` — a pipeline that would have run and been unable to read
    Arabic. It only failed loudly because that substitute could not build a predictor against the
    installed paddle; a compatible one would have shipped.

    So the pair is returned together and must stay that way, and the recognizer must stay Arabic.
    """
    from nidocr.engine import model_names

    names = model_names()
    assert set(names) == {"text_detection_model_name", "text_recognition_model_name"}
    assert "arabic" in names["text_recognition_model_name"].lower(), (
        "the recognition model must be the Arabic one — the card is in Arabic"
    )


# ── Reading a field crop without detecting inside it ──


class _FakeLineRecognizer:
    """Stands in for `paddleocr.TextRecognition`: one text per strip, no detection anywhere."""

    def __init__(self, *texts: str) -> None:
        self.texts = list(texts)
        self.calls = 0

    def predict(self, strip):  # noqa: ANN001, ARG002
        text = self.texts[self.calls] if self.calls < len(self.texts) else ""
        self.calls += 1
        return [{"rec_text": text, "rec_score": 0.9}]


def _crop_with_two_printed_lines():
    import cv2
    import numpy as np

    image = np.full((200, 600, 3), 235, np.uint8)
    cv2.rectangle(image, (20, 30), (580, 60), (40, 40, 40), thickness=-1)
    cv2.rectangle(image, (20, 120), (580, 150), (40, 40, 40), thickness=-1)
    return image


def _recognizer_with(lines):
    import threading

    from nidocr.engine import PaddleRecognizer

    class _Direct(PaddleRecognizer):
        def __init__(self):  # noqa: D107 — deliberately skips PaddleOCR construction
            self._lines = lines
            self._lock = threading.Lock()
            self.detection_calls = 0

        def _run(self, image):  # noqa: ANN001
            self.detection_calls += 1
            return [([[0, 0], [1, 0], [1, 1], [0, 1]], "من الكشف", 0.5)]

    return _Direct()


def test_a_field_crop_is_read_line_by_line_and_never_detected_inside():
    """The failure this closes is invisible, which is what makes it worth a test.

    Running detection inside a crop returns the words the detector is confident about — so a word
    it is not confident about is absent from the field, with every word around it correct and
    correctly ordered. A card printing a six-part name came back with three: the first, the third
    and the last were gone, which no crop can produce and no confidence score reveals.

    The field box already located this text. All that is left is cutting it into printed lines and
    reading each one whole, and detection must not be involved at all.
    """
    recognizer = _recognizer_with(_FakeLineRecognizer("هدى محمد رمضان", "رضوان الحديدي عبده"))
    out = recognizer.recognize(_crop_with_two_printed_lines())

    assert out.text == "هدى محمد رمضان رضوان الحديدي عبده"
    assert recognizer.detection_calls == 0, "detection ran on a crop the field box already located"
    assert recognizer._lines.calls == 2, "each printed line must be read whole"


def test_the_pipeline_is_still_used_when_the_line_recognizer_is_unavailable():
    """The standalone module classes are newer than `PaddleOCR` itself. A version without them
    degrades to the old path rather than failing to start."""
    recognizer = _recognizer_with(None)
    out = recognizer.recognize(_crop_with_two_printed_lines())

    assert recognizer.detection_calls == 1
    assert out.text == "من الكشف"


def test_a_line_recognizer_that_returns_nothing_falls_back_rather_than_reporting_empty():
    """An empty field and a field the direct path could not read are different states."""
    recognizer = _recognizer_with(_FakeLineRecognizer("", ""))
    assert recognizer.recognize(_crop_with_two_printed_lines()).text == "من الكشف"
