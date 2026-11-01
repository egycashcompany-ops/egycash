"""The access code: with OCR_ACCESS_CODE set, nothing but the health check answers without it.

The site is reached from a phone over a shared Wi-Fi, and it reads ID photos: anyone else on that
network must not be able to use it. A browser enters the code once (a cookie remembers it); a server
calling the API sends it in a header. Without OCR_ACCESS_CODE the service behaves as before.
"""

from __future__ import annotations

import json
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr import access  # noqa: E402
from nidocr import service as service_module  # noqa: E402

CODE = "made-up-test-code-4821"  # a test value, not a real code


@pytest.fixture()
def server(monkeypatch):
    monkeypatch.setenv("OCR_ACCESS_CODE", CODE)
    access.reset_attempts()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), service_module.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address
    finally:
        httpd.shutdown()
        httpd.server_close()


def request(address, method, path, body=None, headers=None):
    conn = HTTPConnection(*address, timeout=10)
    conn.request(method, path, body, headers or {})
    response = conn.getresponse()
    data = response.read()
    result = (response.status, dict(response.getheaders()), data)
    conn.close()
    return result


def unlock(address, code=CODE, next_path="/readers"):
    form = urlencode({"code": code, "next": next_path})
    return request(address, "POST", "/unlock", form, {"Content-Type": "application/x-www-form-urlencoded"})


def test_without_the_code_the_page_sends_you_to_enter_it(server):
    status, headers, _ = request(server, "GET", "/readers")
    assert status == 303
    assert headers["Location"].startswith("/unlock")


def test_without_the_code_the_api_refuses(server):
    status, _, body = request(server, "POST", "/jobs", json.dumps({"documentType": "national_id"}),
                              {"Content-Type": "application/json"})
    assert status == 401
    assert "access code" in json.loads(body)["error"]
    status, _, _ = request(server, "GET", "/types")
    assert status == 401


def test_the_health_check_still_answers(server):
    status, _, _ = request(server, "GET", "/health")
    assert status == 200


def test_the_unlock_page_is_shown_without_the_code(server):
    status, headers, body = request(server, "GET", "/unlock?next=/readers")
    assert status == 200
    assert "text/html" in headers["Content-Type"]
    assert b'name="code"' in body


def test_the_right_code_sets_a_cookie_that_opens_everything(server):
    status, headers, _ = unlock(server)
    assert status == 303 and headers["Location"] == "/readers"
    cookie = headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie
    assert CODE not in cookie  # the cookie carries a token derived from the code, never the code
    token = cookie.split(";")[0]
    status, _, _ = request(server, "GET", "/types", headers={"Cookie": token})
    assert status == 200


def test_a_server_can_send_the_code_in_a_header(server):
    status, _, _ = request(server, "GET", "/types", headers={"X-Access-Code": CODE})
    assert status == 200


def test_a_wrong_code_is_refused(server):
    status, headers, _ = unlock(server, code="wrong")
    assert status == 401
    assert "Set-Cookie" not in headers
    status, _, _ = request(server, "GET", "/types", headers={"Cookie": "ocr_access=forged"})
    assert status == 401


def test_after_five_wrong_codes_the_device_waits(server):
    for _ in range(5):
        unlock(server, code="wrong")
    status, _, _ = unlock(server)  # even the right one, for a while
    assert status == 429


def test_the_next_page_must_be_on_this_site(server):
    for target in ("https://elsewhere.example/", "//elsewhere.example/x", "javascript:alert(1)"):
        status, headers, _ = unlock(server, next_path=target)
        assert status == 303 and headers["Location"] == "/readers", target


def test_without_a_code_configured_nothing_changes(monkeypatch):
    monkeypatch.delenv("OCR_ACCESS_CODE", raising=False)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), service_module.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        status, _, _ = request(httpd.server_address, "GET", "/types")
        assert status == 200
    finally:
        httpd.shutdown()
        httpd.server_close()
