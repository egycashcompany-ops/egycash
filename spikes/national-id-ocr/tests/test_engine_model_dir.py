"""A recognition model can be loaded from a folder (a community model, an A/B test), by setting
PADDLE_REC_MODEL_DIR; without it, the baked model is used by name, as before."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.engine import DEFAULT_RECOGNITION_MODEL, model_names  # noqa: E402


def test_by_default_the_baked_model_is_used_by_name(monkeypatch):
    monkeypatch.delenv("PADDLE_REC_MODEL", raising=False)
    monkeypatch.delenv("PADDLE_REC_MODEL_DIR", raising=False)
    names = model_names()
    assert names["text_recognition_model_name"] == DEFAULT_RECOGNITION_MODEL
    assert "text_recognition_model_dir" not in names


def test_a_model_folder_is_passed_with_its_name(monkeypatch):
    monkeypatch.setenv("PADDLE_REC_MODEL", "PP-OCRv6_small_rec")
    monkeypatch.setenv("PADDLE_REC_MODEL_DIR", "/models/extra/arabic_PP-OCRv6_small_rec")
    names = model_names()
    assert names["text_recognition_model_name"] == "PP-OCRv6_small_rec"
    assert names["text_recognition_model_dir"] == "/models/extra/arabic_PP-OCRv6_small_rec"


def test_the_cpu_acceleration_can_be_switched_off(monkeypatch):
    # Paddle 3.3's oneDNN path rejects models exported for 3.0 (measured in an A/B container).
    from nidocr.engine import runtime_options

    monkeypatch.delenv("PADDLE_ENABLE_MKLDNN", raising=False)
    assert runtime_options() == {}
    monkeypatch.setenv("PADDLE_ENABLE_MKLDNN", "0")
    assert runtime_options() == {"enable_mkldnn": False}


def test_a_model_that_reads_right_to_left_text_backwards_can_be_put_in_reading_order(monkeypatch):
    # Measured: the community v6 Arabic model returns each line in visual order ("ةداهش"); PaddleOCR
    # turns the official Arabic models' output around itself, by name, and not a folder model's.
    import pytest

    pytest.importorskip("bidi")
    from nidocr.engine import reading_order

    monkeypatch.delenv("PADDLE_REC_VISUAL_ORDER", raising=False)
    assert reading_order("ةداهش") == "ةداهش"
    monkeypatch.setenv("PADDLE_REC_VISUAL_ORDER", "1")
    assert reading_order("ةداهش") == "شهادة"
    assert reading_order("تقؤملا ءافعإلاب ةداهش") == "شهادة بالإعفاء المؤقت"
