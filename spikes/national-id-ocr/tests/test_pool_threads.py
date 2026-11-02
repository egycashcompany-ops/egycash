"""Workers share the CPU: each Paddle process gets its slice of the cores, not all of them (G5)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.pool import threads_per_worker  # noqa: E402


def test_the_cores_are_split_between_the_workers():
    # Three workers on 12 cores: 4 each. Paddle's default of 8 each would ask for 24 and they slow each other.
    assert threads_per_worker(cores=12, workers=3) == 4


def test_every_worker_gets_at_least_one_thread():
    assert threads_per_worker(cores=2, workers=3) == 1


def test_no_pool_keeps_paddles_own_default():
    assert threads_per_worker(cores=12, workers=0) is None


def test_an_explicit_setting_wins(monkeypatch):
    monkeypatch.setenv("OCR_CPU_THREADS", "2")
    assert threads_per_worker(cores=12, workers=3) == 2
