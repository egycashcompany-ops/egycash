"""A body that is JSON but not an object is the caller's mistake: a 400 that says so, on every route.

Before, `[]` or `"text"` reached `payload.get(...)` and the request died without an answer.
"""

from __future__ import annotations

import json
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr import service as service_module  # noqa: E402


@pytest.fixture()
def server(monkeypatch):
    monkeypatch.delenv("OCR_ACCESS_CODE", raising=False)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), service_module.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield httpd.server_address
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.mark.parametrize("route", ["/extract", "/jobs", "/read", "/diagnose"])
@pytest.mark.parametrize("body", ["[]", '"a photo"', "42"])
def test_a_body_that_is_not_an_object_is_refused(server, route, body):
    conn = HTTPConnection(*server, timeout=10)
    conn.request("POST", route, body, {"Content-Type": "application/json"})
    response = conn.getresponse()
    answer = json.loads(response.read())
    conn.close()
    assert response.status == 400
    assert "object" in answer["error"]
