"""Reading any paper as text in reading order — the `/read` path, without a model.

The fake recognizer returns lines in a deliberately scrambled order, the way detection does; what
is under test is that they come back in the order a person reads them.
"""

from __future__ import annotations

import base64
import json
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr import service as service_module  # noqa: E402
from nidocr.document import read_document  # noqa: E402


def _box(left, top, right, bottom):
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


class _Page:
    """Replays fixed lines for any image, at high confidence, in scrambled order."""

    def __init__(self, lines):
        self.lines = lines

    def read_page(self, image):  # noqa: ANN001, ARG002
        return list(self.lines)

    def detect_lines(self, image):  # noqa: ANN001, ARG002
        return list(self.lines)


_PAGE = np.full((400, 600, 3), 235, np.uint8)


def test_an_arabic_page_reads_top_to_bottom_and_right_to_left():
    page = _Page(
        [
            (_box(50, 100, 250, 130), "الإجمالي", 0.95),
            (_box(300, 20, 580, 50), "فاتورة ضريبية", 0.97),
            (_box(350, 100, 580, 130), "١٢٠ جنيه", 0.93),
        ]
    )
    result = read_document(_PAGE, page)
    assert result["rtl"] is True
    assert result["text"].splitlines() == ["فاتورة ضريبية", "١٢٠ جنيه   الإجمالي"]
    assert result["rotated"] == 0


def test_a_latin_page_reads_left_to_right():
    page = _Page(
        [
            (_box(400, 60, 580, 90), "12.50", 0.96),
            (_box(20, 60, 200, 90), "Coffee", 0.98),
            (_box(20, 10, 300, 40), "RECEIPT", 0.99),
        ]
    )
    result = read_document(_PAGE, page)
    assert result["rtl"] is False
    assert result["text"].splitlines() == ["RECEIPT", "Coffee   12.50"]


def test_empty_reads_are_dropped():
    result = read_document(_PAGE, _Page([(_box(0, 0, 10, 10), "  ", 0.5)]))
    assert result["lines"] == [] and result["text"] == ""


def test_the_read_endpoint_returns_text(monkeypatch):
    page = _Page([(_box(20, 10, 300, 40), "RECEIPT", 0.99)])
    monkeypatch.setattr(service_module, "get_recognizer", lambda: page)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), service_module.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        ok, encoded = cv2.imencode(".jpg", _PAGE)
        body = json.dumps({"imageBase64": base64.b64encode(encoded.tobytes()).decode()})
        conn = HTTPConnection(*httpd.server_address, timeout=30)
        conn.request("POST", "/read", body.encode(), {"Content-Type": "application/json"})
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        conn.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
    assert response.status == 200
    assert payload["text"] == "RECEIPT"
