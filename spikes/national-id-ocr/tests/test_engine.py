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
